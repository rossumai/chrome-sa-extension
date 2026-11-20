// src/sftp/helperCode.ts
// The Python the SFTP app installs as each server's helper hook (see servers.ts). It runs with
// Rossum's `professional_services` library pack, which ships paramiko 3.5.1 (with
// cryptography, bcrypt and PyNaCl; the default pack has no SSH library — both measured
// 2026-11-20), so nothing is installed at run time.
//
// One invocation is one SSH session: connect, check the pinned host key, sign in with the
// hook's secret, run `ops` in order, close. Each op answers on its own, so one failed delete
// does not hide the listing that follows it. A failure is RETURNED as `error`, never raised:
// a raised exception reaches the Console only as Rossum's generic "Hook invocation failed".
// Rossum gives up on an invocation after 30 s, so the connect is capped at CONNECT_TIMEOUT and a
// server that does not answer is reported with the address it would have to allow.
// A Lambda answer and request are capped near 6 MB and base64 adds a third, so file contents
// move in parts of at most CHUNK_BYTES (`download` and `upload` take an `offset`); the Console
// joins them (transfer.ts). A listing with `depth: 1` also lists the folder's subfolders, so the
// Console can open them without another call.
//
// A change to this string makes every saved helper stale; the app patches a stale hook's code
// before its next call (servers.ts `serverFromHook`, Browser.tsx).
export const HELPER_CODE = String.raw`# SFTP helper for the Rossum SA extension's Console. Installed and updated by the extension.
import base64
import hashlib
import io
import socket
import stat
import urllib.request

import paramiko

CHUNK_BYTES = 3 * 1024 * 1024
MAX_CHILDREN = 25
CONNECT_TIMEOUT = 10


class Unreachable(Exception):
    pass


def _egress_ip():
    try:
        return urllib.request.urlopen("https://checkip.amazonaws.com", timeout=3).read().decode().strip()
    except Exception:
        return None


# CONNECT_TIMEOUT is the budget for ALL of the host's addresses together: a name with three
# addresses would otherwise wait three times as long, past Rossum's 30 s.
def _connect(host, port):
    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    per_address = max(2.0, CONNECT_TIMEOUT / len(addresses))
    last = None
    for family, kind, proto, _, address in addresses:
        sock = socket.socket(family, kind, proto)
        sock.settimeout(per_address)
        try:
            sock.connect(address)
            sock.settimeout(CONNECT_TIMEOUT)
            return sock
        except OSError as e:
            sock.close()
            last = e
    if isinstance(last, (socket.timeout, TimeoutError)):
        ip = _egress_ip()
        where = (" Rossum connects from " + ip + "; the server may have to allow that address.") if ip else ""
        raise Unreachable(host + ":" + str(port) + " did not answer within " + str(CONNECT_TIMEOUT) + " s." + where)
    raise last


def _message(e):
    return str(e) or type(e).__name__


def _private_key(text):
    for cls in (paramiko.Ed25519Key, paramiko.ECDSAKey, paramiko.RSAKey):
        try:
            return cls.from_private_key(io.StringIO(text))
        except Exception:
            pass
    raise ValueError("The private key could not be read. Use an unencrypted OpenSSH or PEM key.")


def _fingerprint(key):
    digest = base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip("=")
    return key.get_name() + " SHA256:" + digest


def _entry(a):
    return {"name": a.filename, "size": a.st_size or 0, "mtime": a.st_mtime or 0,
            "dir": stat.S_ISDIR(a.st_mode or 0)}


def _join(path, name):
    return name if path in ("", ".") else path.rstrip("/") + "/" + name


def _list(sftp, path, depth):
    entries = [_entry(a) for a in sftp.listdir_attr(path)]
    out = {"entries": entries}
    if depth > 0:
        children = {}
        for e in [e for e in entries if e["dir"] and e["name"] not in (".", "..")][:MAX_CHILDREN]:
            try:
                children[e["name"]] = [_entry(a) for a in sftp.listdir_attr(_join(path, e["name"]))]
            except Exception:
                pass
        out["children"] = children
    return out


def _run(sftp, op):
    kind, path = op.get("op"), op.get("path") or "."
    if kind == "list":
        return _list(sftp, path, int(op.get("depth") or 0))
    if kind == "download":
        offset = int(op.get("offset") or 0)
        length = min(int(op.get("length") or CHUNK_BYTES), CHUNK_BYTES)
        size = sftp.stat(path).st_size or 0
        with sftp.open(path, "rb") as f:
            f.seek(offset)
            data = f.read(length)
        return {"data": base64.b64encode(data).decode(), "size": size}
    if kind == "upload":
        data = base64.b64decode(op.get("data") or "")
        if len(data) > CHUNK_BYTES:
            raise ValueError("A part is over 3 MB.")
        offset = int(op.get("offset") or 0)
        with sftp.open(path, "wb" if offset == 0 else "r+b") as f:
            f.seek(offset)
            f.write(data)
        return {}
    if kind == "delete":
        sftp.remove(path)
        return {}
    if kind == "rename":
        if op.get("replace"):
            try:
                sftp.posix_rename(path, op["to"])
                return {}
            except IOError:
                try:
                    sftp.remove(op["to"])
                except IOError:
                    pass
        sftp.rename(path, op["to"])
        return {}
    raise ValueError("Unknown operation: " + str(kind))


def _answer(**fields):
    return {"messages": [], "operations": [], **fields}


def rossum_hook_request_handler(payload):
    settings = payload.get("settings") or {}
    secrets = payload.get("secrets") or {}
    try:
        sock = _connect(settings["host"], int(settings["port"]))
        transport = paramiko.Transport(sock)
        transport.banner_timeout = CONNECT_TIMEOUT
        transport.auth_timeout = CONNECT_TIMEOUT
        try:
            transport.start_client(timeout=CONNECT_TIMEOUT)
            host_key = _fingerprint(transport.get_remote_server_key())
            pinned = settings.get("host_key")
            if pinned and pinned != host_key:
                return _answer(error="The server's host key changed.", host_key=host_key,
                               host_key_changed=True)
            if settings.get("auth") == "key":
                transport.auth_publickey(settings["user"], _private_key(secrets.get("private_key") or ""))
            else:
                transport.auth_password(settings["user"], secrets.get("password") or "")
            sftp = paramiko.SFTPClient.from_transport(transport)
            results = []
            for op in payload.get("ops") or []:
                try:
                    results.append({"ok": True, **_run(sftp, op)})
                except Exception as e:
                    results.append({"ok": False, "error": _message(e)})
            return _answer(host_key=host_key, results=results)
        finally:
            transport.close()
    except Exception as e:
        return _answer(error=_message(e))
`;
