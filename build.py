import os
import sys
import subprocess
import shutil
import time

def build():
    print("=== Relay PyInstaller Builder ===")
    
    # 1. Kill any running Relay processes
    if sys.platform == "win32":
        print("Checking and stopping any running Relay.exe instances...")
        try:
            subprocess.run(["taskkill", "/F", "/IM", "Relay.exe"], capture_output=True)
            time.sleep(1)
        except Exception:
            pass

    # 2. Clean build and dist directories
    for folder in ["build", "dist"]:
        if os.path.exists(folder):
            print(f"Cleaning {folder}/...")
            try:
                shutil.rmtree(folder)
            except Exception as e:
                print(f"Warning: Could not remove {folder}: {e}")

    # 3. Run PyInstaller
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--noconsole",
        "--clean",
        "--name", "Relay",
        "--add-data", f"fonts{os.pathsep}fonts",
        "relay_gui.py"
    ]
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd)

    if result.returncode == 0:
        exe_path = os.path.abspath(os.path.join("dist", "Relay.exe"))
        print("\n==========================================")
        print(f"SUCCESS: Relay built cleanly at:\n{exe_path}")
        print("==========================================")
    else:
        print(f"\nBuild failed with return code {result.returncode}")

if __name__ == "__main__":
    build()
