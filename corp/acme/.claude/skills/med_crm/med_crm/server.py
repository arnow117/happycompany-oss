#!/usr/bin/env python3
"""med_crm JSON-RPC server.

Reads newline-delimited JSON-RPC 2.0 requests on stdin and writes responses on
stdout, dispatching each `method` (tool name) to the matching handler in cli.py.
This is the execution path the platform uses for `server`-mode skills
(AppServerMgr.startServer + .call); the same handlers also back the CLI.

The per-tenant SQLite DB is resolved by cli.connect() via the ACME_CRM_DB env
var, which the platform injects when starting the server.
"""
import json
import sys
from types import SimpleNamespace

import cli  # sibling module (med_crm/cli.py); the script's dir is on sys.path

# Tool name -> handler. Only handlers actually implemented in cli.py are exposed;
# anything else yields a JSON-RPC error rather than a silent no-op.
HANDLERS = {
    name: getattr(cli, name)
    for name in (
        "search_hospitals",
        "global_search",
        "hospital_info",
        "search_devices",
        "list_maintenance",
        "search_bids",
        "add_incident",
        "add_sales_activity",
        "add_contact",
        "contract_intake",
        "create_service_record",
        "finance_settlement",
    )
    if hasattr(cli, name)
}


def handle(request):
    rid = request.get("id")
    method = request.get("method")
    params = dict(request.get("params") or {})
    params.pop("callerContext", None)  # platform-injected; handlers ignore it
    handler = HANDLERS.get(method)
    if handler is None:
        return {"jsonrpc": "2.0", "id": rid, "error": {"message": f"unknown method: {method}"}}
    try:
        result = handler(SimpleNamespace(**params))
        return {"jsonrpc": "2.0", "id": rid, "result": result}
    except Exception as exc:  # noqa: BLE001 - surface any handler failure as a JSON-RPC error
        return {"jsonrpc": "2.0", "id": rid, "error": {"message": str(exc)}}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue
        response = handle(request)
        sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
