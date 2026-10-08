#!/usr/bin/env node
// Sobe (se faltarem) o dash web :7423 e a faixa de tok/s no rodape do ZCode.
// Chamado em background pelo SessionStart; nao bloqueia o hook.

import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function ping() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:7423/api/token-rate", { timeout: 800 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function spawnDetached(cmd, args) {
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    cwd: root,
  });
  child.unref();
}

if (!(await ping())) {
  spawnDetached(process.execPath, [path.join(root, "dashboard", "server.mjs")]);
}

if (process.platform === "win32") {
  spawnDetached("powershell.exe", [
    "-NoProfile",
    "-STA",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-File",
    path.join(root, "dashboard", "overlay.ps1"),
  ]);
}

if (process.platform === "linux") {
  spawnDetached("python3", [path.join(root, "dashboard", "overlay.py")]);
}
