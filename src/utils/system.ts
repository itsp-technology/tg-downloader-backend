import { exec } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/**
 * Invokes native Windows FolderBrowserDialog via PowerShell.
 */
export function openFolderPicker(): Promise<string | null> {
  return new Promise((resolve) => {
    const cmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.windows.forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Media Directory'; if($f.ShowDialog() -eq 'OK'){ Write-Output $f.SelectedPath }"`;
    exec(cmd, (error, stdout) => {
      if (error) return resolve(null);
      const selected = stdout.trim();
      resolve(selected || null);
    });
  });
}

/**
 * Opens Windows File Explorer pointing to the downloaded file/folder.
 */
export function openInExplorer(targetPath: string): void {
  const resolved = path.resolve(targetPath);
  if (fs.existsSync(resolved)) {
    exec(`explorer.exe /select,"${resolved}"`);
  }
}