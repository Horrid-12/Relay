"""
Apparate Desktop GUI
A native Windows application to sync HackerRank submissions to GitHub.
Built with tkinter — compiles to a standalone .exe via PyInstaller.
"""

import tkinter as tk
from tkinter import scrolledtext, ttk
import threading
import os
import sys

# Ensure Playwright finds installed browsers on Windows even when running from a packaged .exe
if sys.platform == "win32" and "PLAYWRIGHT_BROWSERS_PATH" not in os.environ:
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if local_app_data:
        default_pw_path = os.path.join(local_app_data, "ms-playwright")
        if os.path.exists(default_pw_path):
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = default_pw_path

import io
import queue
import ctypes
import json
import pathlib
import webbrowser

# Add project root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__))))


# ── Load bundled Inter font (Windows) ─────────────────────────────────────
def _load_fonts():
    """Register bundled Inter .ttf files with Windows GDI so tkinter can use them."""
    fonts_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
    FR_PRIVATE = 0x10  # font is available only to this process
    for ttf in ("Inter-Regular.ttf", "Inter-Bold.ttf"):
        path = os.path.join(fonts_dir, ttf)
        if os.path.isfile(path):
            ctypes.windll.gdi32.AddFontResourceExW(path, FR_PRIVATE, 0)

_load_fonts()


# ── Color Palette ──────────────────────
BG           = "#1e1e1e"
BG_FRAME     = "#262626"
BG_INPUT     = "#1a1a1a"
BG_BUTTON    = "#333333"
BG_BTN_HOVER = "#3e3e3e"
BG_BTN_PRESS = "#2a2a2a"
BG_LOG       = "#141414"
FG           = "#d4d4d4"
FG_MUTED     = "#808080"
FG_DIM       = "#5a5a5a"
BORDER       = "#3a3a3a"
FONT_FAMILY  = "Inter"


class ApparateGUI:

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Apparate v0.2")
        self.root.configure(bg=BG)
        self.root.resizable(False, False)

        # Window size and centering
        w, h = 420, 640
        sx = (self.root.winfo_screenwidth() - w) // 2
        sy = (self.root.winfo_screenheight() - h) // 2
        self.root.geometry(f"{w}x{h}+{sx}+{sy}")

        # Try to set icon (optional)
        try:
            self.root.iconbitmap(default="")
        except Exception:
            pass

        self.log_queue = queue.Queue()
        self._build_ui()
        self._load_saved_config()
        self._poll_log_queue()

    # ── UI Construction ───────────────────────────────────────────────────

    def _build_ui(self):
        pad = 16

        # ── Title ─────────────────────────────────────────────────────────
        title_frame = tk.Frame(self.root, bg=BG)
        title_frame.pack(fill="x", padx=pad, pady=(pad, 4))

        tk.Label(
            title_frame, text="Apparate", font=(FONT_FAMILY, 15, "bold"),
            bg=BG, fg=FG
        ).pack(side="left")

        tk.Label(
            title_frame, text="v0.2", font=(FONT_FAMILY, 9),
            bg=BG, fg=FG_DIM
        ).pack(side="left", padx=(6, 0), pady=(5, 0))

        tk.Label(
            self.root, text="Sync HackerRank submissions to GitHub",
            font=(FONT_FAMILY, 9), bg=BG, fg=FG_MUTED
        ).pack(anchor="w", padx=pad, pady=(0, 12))

        # ── HackerRank Section ────────────────────────────────────────────
        hr_frame = self._make_group(self.root, "HackerRank")
        hr_frame.pack(fill="x", padx=pad, pady=(0, 10))

        self.entry_user = self._make_field(hr_frame, "Username")
        self.entry_cookie = self._make_field(hr_frame, "_hrank_session Cookie", show="*")
        help_label = tk.Label(hr_frame._content, text="(How to get your session cookie?)", fg="#58a6ff", bg=BG_FRAME, cursor="hand2", font=(FONT_FAMILY, 8, "underline"))
        help_label.pack(anchor="w", padx=4, pady=(0, 6))
        help_label.bind("<Button-1>", lambda e: self.open_cookie_help())
        self.browser_login_var = tk.BooleanVar(value=False)
        self.browser_choice_var = tk.StringVar(value="Google Chrome")

        gh_frame = self._make_group(self.root, "GitHub")
        gh_frame.pack(fill="x", padx=pad, pady=(0, 14))

        self.entry_token = self._make_field(gh_frame, "Access Token", show="•")
        self.entry_repo  = self._make_field(gh_frame, "Repository")

        # Browser token generator / helper
        gh_btn_row = tk.Frame(gh_frame._content, bg=BG_FRAME)
        gh_btn_row.pack(fill="x", pady=(6, 0))
        self.btn_gh_browser = tk.Button(
            gh_btn_row, text="Get Token in Browser",
            font=(FONT_FAMILY, 8),
            bg=BG_INPUT, fg=FG_MUTED, activebackground=BG_BTN_PRESS,
            activeforeground=FG, relief="flat", cursor="hand2",
            bd=0, padx=8, pady=4, highlightbackground=BORDER, highlightthickness=1,
            command=self._open_github_token_page
        )
        self.btn_gh_browser.pack(anchor="w")
        self.btn_gh_browser.bind("<Enter>", lambda e: self.btn_gh_browser.config(bg=BG_BUTTON, fg=FG))
        self.btn_gh_browser.bind("<Leave>", lambda e: self.btn_gh_browser.config(bg=BG_INPUT, fg=FG_MUTED))

        # ── Sync Button ──────────────────────────────────────────────────
        self.btn_sync = tk.Button(
            self.root, text="Sync Submissions",
            font=(FONT_FAMILY, 10, "bold"),
            bg=BG_BUTTON, fg=FG, activebackground=BG_BTN_PRESS,
            activeforeground=FG, relief="flat", cursor="hand2",
            bd=0, padx=20, pady=8, command=self._on_sync
        )
        self.btn_sync.pack(fill="x", padx=pad, pady=(0, 14))
        self.btn_sync.bind("<Enter>", lambda e: self.btn_sync.config(bg=BG_BTN_HOVER))
        self.btn_sync.bind("<Leave>", lambda e: self.btn_sync.config(bg=BG_BUTTON))

        # ── Log Area ─────────────────────────────────────────────────────
        log_label = tk.Label(
            self.root, text="LOG", font=(FONT_FAMILY, 8, "bold"),
            bg=BG, fg=FG_DIM
        )
        log_label.pack(anchor="w", padx=pad, pady=(0, 4))

        self.log_text = scrolledtext.ScrolledText(
            self.root, font=("Consolas", 9), bg=BG_LOG, fg=FG_MUTED,
            insertbackground=FG_MUTED, relief="flat", bd=0,
            wrap="word", height=7, state="disabled",
            selectbackground="#3a3a3a", selectforeground=FG
        )
        self.log_text.pack(fill="both", expand=True, padx=pad, pady=(0, pad))

        # Style the scrollbar
        self.log_text.vbar.config(
            troughcolor=BG_LOG, bg=BORDER, activebackground=FG_DIM,
            relief="flat", bd=0, width=8
        )

    # ── Helpers ───────────────────────────────────────────────────────────

    def _make_group(self, parent, title):
        """Create a labeled group frame (like LabelFrame but custom styled)."""
        outer = tk.Frame(parent, bg=BG)

        # Title label
        tk.Label(
            outer, text=title, font=(FONT_FAMILY, 8, "bold"),
            bg=BG, fg=FG_DIM
        ).pack(anchor="w", pady=(0, 6))

        # Inner frame with border
        inner = tk.Frame(outer, bg=BG_FRAME, highlightbackground=BORDER,
                         highlightthickness=1, padx=14, pady=10)
        inner.pack(fill="x")

        # Store inner as the content target
        outer._content = inner
        return outer

    def _make_field(self, group_outer, label, show=None):
        """Create a label + entry row inside a group frame."""
        container = group_outer._content

        row = tk.Frame(container, bg=BG_FRAME)
        row.pack(fill="x", pady=3)

        tk.Label(
            row, text=label, font=(FONT_FAMILY, 9), bg=BG_FRAME,
            fg=FG_MUTED, width=12, anchor="w"
        ).pack(side="left")

        entry = tk.Entry(
            row, font=(FONT_FAMILY, 9), bg=BG_INPUT, fg=FG,
            insertbackground=FG_MUTED, relief="flat", bd=0,
            highlightbackground=BORDER, highlightthickness=1,
            highlightcolor=FG_DIM, show=show or ""
        )
        entry.pack(side="left", fill="x", expand=True, ipady=4, padx=(4, 0))

        return entry

    # ── Browser Helpers & Config Persistence ───────────────────────────────

    def _open_github_token_page(self):
        """Opens GitHub settings page to generate a token with 'repo' scope."""
        token_url = "https://github.com/settings/tokens/new?description=Apparate+HackerRank+Sync&scopes=repo"
        webbrowser.open(token_url)
        self._log("Opened GitHub in browser.")
        self._log("Generate the token with 'repo' scope and paste it into Access Token.")

    def _get_config_path(self):
        config_dir = pathlib.Path.home() / ".apparate"
        config_dir.mkdir(parents=True, exist_ok=True)
        return config_dir / "config.json"

    def _load_saved_config(self):
        try:
            path = self._get_config_path()
            if path.exists():
                with open(path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                if cfg.get("user"):
                    self.entry_user.insert(0, cfg["user"])
                if cfg.get("token"):
                    self.entry_token.insert(0, cfg["token"])
                if cfg.get("repo"):
                    self.entry_repo.insert(0, cfg["repo"])
                if cfg.get("browser_login"):
                    self.browser_login_var.set(True)
                    self._toggle_browser_login()
                if cfg.get("browser_choice"):
                    self.browser_choice_var.set(cfg["browser_choice"])
        except Exception:
            pass

    def _save_config(self, user, token, repo, browser_mode, browser_choice):
        try:
            path = self._get_config_path()
            cfg = {
                "user": user,
                "token": token,
                "repo": repo,
                "browser_login": browser_mode,
                "browser_choice": browser_choice
            }
            with open(path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, indent=2)
        except Exception:
            pass

    # ── Toggle ─────────────────────────────────────────────────────────────


    def open_cookie_help(self):
        from tkinter import messagebox
        msg = "To bypass Cloudflare & Microsoft Family Safety, Apparate now uses your session cookie directly.\n\n" \
              "1. Log into HackerRank in your normal browser (Edge/Chrome).\n" \
              "2. Press F12 to open Developer Tools.\n" \
              "3. Go to Application (Chrome) or Storage (Firefox) tab.\n" \
              "4. Expand Cookies and select hackerrank.com.\n" \
              "5. Find the cookie named '_hrank_session'.\n" \
              "6. Copy its Value and paste it here."
        messagebox.showinfo("How to get Session Cookie", msg)
    def _toggle_browser_login(self):
        """Enable/disable credential fields based on the checkbox."""
        if self.browser_login_var.get():
            self.entry_user.config(state="disabled", bg="#161616")
            self.entry_pass.config(state="disabled", bg="#161616")
            self.opt_browser.config(state="normal")
        else:
            self.entry_user.config(state="normal", bg=BG_INPUT)
            self.entry_pass.config(state="normal", bg=BG_INPUT)

    # ── Sync Logic ────────────────────────────────────────────────────────

    def _on_sync(self):
        browser_mode = self.browser_login_var.get()
        browser_choice = self.browser_choice_var.get()
        user   = self.entry_user.get().strip()
        passwd = self.entry_cookie.get()
        token  = self.entry_token.get().strip()
        repo   = self.entry_repo.get().strip()

        if not token or not repo:
            self._log("Please fill in the GitHub fields.")
            return

        if not browser_mode and (not user or not passwd):
            self._log("Please fill in HackerRank credentials, or use browser login.")
            return

        # Auto-save configuration for next time
        self._save_config(user, token, repo, browser_mode, browser_choice)

        # Disable button
        self.btn_sync.config(state="disabled", text="Syncing…", bg=BG_BTN_PRESS)
        self._clear_log()
        self._log("Starting sync…")

        thread = threading.Thread(
            target=self._run_sync,
            args=(user, passwd, token, repo, browser_mode, browser_choice),
            daemon=True
        )
        thread.start()

    def _run_sync(self, user, passwd, token, repo, browser_mode=False, browser_choice="Firefox / Floorp"):
        """Run Apparate sync in a background thread."""
        old_stdout = sys.stdout
        sys.stdout = _LogWriter(self.log_queue)

        try:
            import scripts.apparate as apparate_module
            apparate_module.submissions_repo = repo
            apparate_module.hackerrank_username = user
            apparate_module.hackerrank_cookie = passwd
            apparate_module.github_token = token
            apparate_module.browser_login_mode = browser_mode
            apparate_module.browser_name_choice = browser_choice

            from datetime import datetime
            start = datetime.now()
            self.log_queue.put(start.strftime("Executing on %a, %d %b %Y, %H:%M:%S"))

            app = apparate_module.Apparate()
            new_subs, codes = app.check_updates()

            if new_subs is not None:
                app.update_repo(new_subs, codes)
                app.update_submissions(new_subs)
            else:
                self.log_queue.put("No new submissions found.")

            diff = (datetime.now() - start).seconds
            self.log_queue.put(f"Done in {diff // 60}m {diff % 60}s.")

        except Exception as e:
            self.log_queue.put(f"[Error] {e}")

        finally:
            sys.stdout = old_stdout
            self.log_queue.put("__RESET_BTN__")

    # ── Logging ───────────────────────────────────────────────────────────

    def _poll_log_queue(self):
        """Check for new log messages from the background thread."""
        while not self.log_queue.empty():
            msg = self.log_queue.get_nowait()
            if msg == "__RESET_BTN__":
                self.btn_sync.config(
                    state="normal", text="Sync Submissions", bg=BG_BUTTON
                )
            else:
                self._log(msg)
        self.root.after(100, self._poll_log_queue)

    def _log(self, text):
        self.log_text.config(state="normal")
        self.log_text.insert("end", text + "\n")
        self.log_text.see("end")
        self.log_text.config(state="disabled")

    def _clear_log(self):
        self.log_text.config(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.config(state="disabled")

    # ── Run ───────────────────────────────────────────────────────────────

    def run(self):
        self.root.mainloop()


class _LogWriter(io.TextIOBase):
    """Redirect print() output to a queue."""

    def __init__(self, q):
        self._q = q
        self._buf = ""

    def write(self, text):
        if not text:
            return 0
        self._buf += text
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            stripped = line.strip()
            if stripped:
                self._q.put(stripped)
        return len(text)

    def flush(self):
        if self._buf.strip():
            self._q.put(self._buf.strip())
            self._buf = ""


if __name__ == "__main__":
    gui = ApparateGUI()
    gui.run()
