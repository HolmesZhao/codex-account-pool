#!/usr/bin/env python3
"""Standalone Codex account selector. Python 3.8+ standard library only."""
import argparse
import getpass
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


def ask_keys():
    while True:
        try:
            count = int(input("API Key 数量（至少 1 个）: ").strip())
            if count >= 1:
                break
        except ValueError:
            pass
        print("请输入大于等于 1 的整数。", file=sys.stderr)
    keys = []
    for index in range(1, count + 1):
        key = getpass.getpass("API Key %d: " % index).strip()
        if key:
            keys.append(key)
    return keys


def config_path():
    return os.environ.get("CODEX_POOL_SELECT_CONFIG", os.path.expanduser("~/.config/codex-pool-select/config.json"))


def load_config():
    try:
        with open(config_path(), "r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def save_config(server_url, keys):
    path = config_path()
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, mode=0o700, exist_ok=True)
    atomic_write(path, {"serverUrl": server_url.rstrip("/"), "apiKeys": keys})


def env_keys():
    values = [os.environ.get("CODEX_POOL_API_KEYS", ""), os.environ.get("CODEX_POOL_API_KEY_1", ""), os.environ.get("CODEX_POOL_API_KEY_2", "")]
    keys = []
    for value in values:
        keys.extend(item.strip() for item in value.replace(",", "\n").splitlines() if item.strip())
    return list(dict.fromkeys(keys))


def request_account(server_url, api_key, number):
    request = urllib.request.Request(server_url.rstrip("/") + "/api/openapi/account", headers={"X-API-Key": api_key, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        try:
            payload = json.load(error)
            message = payload.get("error", {}).get("message", error.code)
        except Exception:
            message = error.code
        raise RuntimeError("第 %d 个 API Key 请求失败：%s" % (number, message))
    except Exception as error:
        raise RuntimeError("第 %d 个 API Key 请求失败：%s" % (number, error))
    account = payload.get("data") or {}
    auth = account.get("auth") or {}
    if not account.get("accountId") or not auth.get("tokens", {}).get("access_token"):
        raise RuntimeError("第 %d 个 API Key 未返回完整 auth 凭证，请升级站点服务端" % number)
    if auth["tokens"].get("refresh_token"):
        raise RuntimeError("服务端返回了包含 RT 的凭证，拒绝安装")
    account["index"] = number
    return account


def remaining(window):
    if not window:
        return "未知"
    if window.get("remainingPercent") is not None:
        return str(round(window["remainingPercent"]))
    used = window.get("usedPercent")
    return str(round(100 - used)) if used is not None else "未知"


def show_accounts(accounts):
    print("可用账号额度：", file=sys.stderr)
    for account in accounts:
        print("[%d] %s (%s)" % (account["index"], account.get("email") or account["accountId"], account["accountId"]), file=sys.stderr)
        quota = account.get("quota") or {}
        print("    五小时：%s%% 剩余；每周：%s%% 剩余" % (remaining(quota.get("fiveHour")), remaining(quota.get("weekly"))), file=sys.stderr)
        print("    缓存时间：%s%s" % (quota.get("collectedAt") or "暂无", "（历史数据）" if quota.get("stale") else ""), file=sys.stderr)
    print("请选择要切换的账号 [1-%d]：" % len(accounts), end="", file=sys.stderr)


def install(account, auth_path):
    auth = account.get("auth")
    if not isinstance(auth, dict) or not auth.get("tokens", {}).get("access_token") or auth["tokens"].get("refresh_token"):
        raise RuntimeError("缺少合法的网页下载格式凭证，拒绝覆盖本机文件")
    directory = os.path.dirname(auth_path) or "."
    os.makedirs(directory, mode=0o700, exist_ok=True)
    backup = auth_path + ".codex-pool-backup"
    try:
        with open(auth_path, "r", encoding="utf-8") as handle:
            previous = json.load(handle)
        previous.setdefault("tokens", {})["refresh_token"] = ""
        atomic_write(backup, previous)
    except (OSError, ValueError, TypeError):
        pass
    atomic_write(auth_path, auth)


def atomic_write(path, value):
    directory = os.path.dirname(path) or "."
    fd, temporary = tempfile.mkstemp(prefix=".codex-pool-", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def restart():
    if sys.platform != "darwin":
        raise RuntimeError("自动重启 Codex 目前只支持 macOS")
    app = os.environ.get("CODEX_POOL_CODEX_APP", "Codex")
    result = subprocess.run(["pkill", "-x", app], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if result.returncode not in (0, 1):
        raise RuntimeError("关闭 %s 失败" % app)
    time.sleep(0.7)
    subprocess.run(["open", "-a", app], check=True)
    return {"restarted": True, "app": app}


def safe_account(account):
    return {key: account.get(key) for key in ("index", "accountId", "email", "tokenExpiresAt", "generation", "quota")}


def main():
    parser = argparse.ArgumentParser(description="独立 Codex 账号额度查询与切换工具")
    parser.add_argument("--configure", action="store_true", help="交互创建或覆盖本地配置")
    parser.add_argument("--no-restart", action="store_true")
    parser.add_argument("--json", action="store_true")
    options = parser.parse_args()
    if options.configure:
        server_url = input("号池服务地址（例如 http://127.0.0.1:4317）: ").strip()
        keys = ask_keys()
        if not server_url or not keys:
            raise RuntimeError("服务地址和 API Key 不能为空")
        save_config(server_url, keys)
        print("配置已写入 %s" % config_path())
        return
    saved = load_config()
    server_url = os.environ.get("CODEX_POOL_SERVER_URL") or saved.get("serverUrl") or input("号池服务地址（例如 http://127.0.0.1:4317）: ").strip()
    keys = env_keys() or [str(key).strip() for key in saved.get("apiKeys", []) if str(key).strip()]
    if not keys:
        keys = ask_keys()
    if not keys:
        raise RuntimeError("至少需要一个 API Key")
    if not saved.get("serverUrl") or not saved.get("apiKeys") or os.environ.get("CODEX_POOL_SERVER_URL") or env_keys():
        save_config(server_url, keys)
    accounts = [request_account(server_url, key, index) for index, key in enumerate(keys, 1)]
    if not options.json:
        show_accounts(accounts)
    selected = int(input(""))
    if selected < 1 or selected > len(accounts):
        raise RuntimeError("选择无效，请输入 1-%d" % len(accounts))
    account = accounts[selected - 1]
    auth_path = os.environ.get("CODEX_POOL_AUTH_PATH", os.path.expanduser("~/.codex/auth.json"))
    install(account, auth_path)
    result = {"accounts": [safe_account(item) for item in accounts], "selected": safe_account(account), "switched": True, "accountId": account["accountId"], "restartRequired": not options.no_restart}
    if not options.no_restart:
        result.update(restart())
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("切换失败：%s" % error, file=sys.stderr)
        sys.exit(1)
