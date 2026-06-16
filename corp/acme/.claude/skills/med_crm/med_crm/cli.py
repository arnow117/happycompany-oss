#!/usr/bin/env python3
import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime


def connect():
    db_path = os.environ.get("ACME_CRM_DB")
    if not db_path:
        raise SystemExit("ACME_CRM_DB is required")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def rows_to_dicts(_cursor, rows):
    return [dict(row) for row in rows]


def ensure_artifact_tables(db):
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS contract_intakes (
          contract_id TEXT PRIMARY KEY,
          customer TEXT NOT NULL,
          device_model TEXT NOT NULL,
          service_period_start TEXT NOT NULL,
          service_period_end TEXT NOT NULL,
          maintenance_cycle TEXT NOT NULL,
          payment_terms TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS maintenance_schedules (
          schedule_id TEXT PRIMARY KEY,
          contract_id TEXT NOT NULL,
          customer TEXT NOT NULL,
          device_model TEXT NOT NULL,
          cycle TEXT NOT NULL,
          next_run_at TEXT,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS service_incidents (
          incident_id TEXT PRIMARY KEY,
          hospital TEXT NOT NULL,
          device TEXT,
          description TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS service_records (
          record_id TEXT PRIMARY KEY,
          contract_id TEXT NOT NULL,
          customer TEXT NOT NULL,
          device_model TEXT NOT NULL,
          service_date TEXT NOT NULL,
          diagnosis TEXT NOT NULL,
          parts_used TEXT,
          customer_signed TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS finance_settlements (
          settlement_id TEXT PRIMARY KEY,
          contract_id TEXT NOT NULL,
          service_record_id TEXT NOT NULL,
          billing_amount TEXT,
          archive_status TEXT,
          created_at TEXT NOT NULL
        );
        """
    )


def now_iso():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def schedule_id_for(contract_id):
    return f"schedule-{contract_id}"


def search_hospitals(args):
    with connect() as db:
        cursor = db.execute(
            """
            SELECT id, name, normalized_name, province, city, district, level, channel
            FROM hospitals
            WHERE name LIKE ? OR normalized_name LIKE ?
            ORDER BY id
            """,
            (f"%{args.keyword}%", f"%{args.keyword}%"),
        )
        items = rows_to_dicts(cursor, cursor.fetchall())
    return {"query": args.keyword, "items": items}


def global_search(args):
    hospitals = search_hospitals(args)
    return {"query": args.keyword, "hospitals": hospitals["items"]}


def hospital_info(args):
    with connect() as db:
        cursor = db.execute(
            """
            SELECT id, name, normalized_name, province, city, district, level, channel
            FROM hospitals
            WHERE name LIKE ? OR normalized_name LIKE ?
            ORDER BY id
            LIMIT 1
            """,
            (f"%{args.hospital_name}%", f"%{args.hospital_name}%"),
        )
        row = cursor.fetchone()
        if not row:
            return {"found": False}
        hospital = rows_to_dicts(cursor, [row])[0]
        hospital_id = hospital["id"]
        devices = db.execute("SELECT COUNT(*) FROM devices WHERE hospital_id = ?", (hospital_id,)).fetchone()[0]
        maintenance = db.execute("SELECT COUNT(*) FROM maintenance_devices WHERE hospital_id = ?", (hospital_id,)).fetchone()[0]
        bids = db.execute("SELECT COUNT(*) FROM bid_wins WHERE hospital_id = ?", (hospital_id,)).fetchone()[0]
    return {
        "found": True,
        "hospital": hospital,
        "counts": {"devices": devices, "maintenance": maintenance, "bids": bids},
    }


def search_devices(args):
    keyword = getattr(args, "keyword", "") or ""
    hospital_id = getattr(args, "hospital_id", None)
    values = []
    where = []
    if keyword:
        like = f"%{keyword}%"
        where.append("(product_name LIKE ? OR brand LIKE ? OR ucmid LIKE ? OR supplier LIKE ?)")
        values.extend([like, like, like, like])
    if hospital_id:
        where.append("hospital_id = ?")
        values.append(hospital_id)
    clause = " AND ".join(where) if where else "1 = 1"
    with connect() as db:
        cursor = db.execute(
            f"""
            SELECT id, hospital_id, ucmid, supplier, device_category, product_name, brand, product_tier, source
            FROM devices
            WHERE {clause}
            ORDER BY id
            LIMIT 30
            """,
            tuple(values),
        )
        items = rows_to_dicts(cursor, cursor.fetchall())
    return {"query": keyword, "items": items, "count": len(items)}


def list_maintenance(args):
    hospital_id = getattr(args, "hospital_id", None)
    values = []
    where = []
    if hospital_id:
        where.append("hospital_id = ?")
        values.append(hospital_id)
    if getattr(args, "expiring_before", None):
        where.append("contract_end <= ?")
        values.append(args.expiring_before)
    clause = " AND ".join(where) if where else "1 = 1"
    with connect() as db:
        cursor = db.execute(
            f"""
            SELECT id, hospital_id, product_name, brand, product_tier, contract_start, contract_end,
                   planned_count, completed_count, next_maintenance_date, reminder_frequency, notes
            FROM maintenance_devices
            WHERE {clause}
            ORDER BY contract_end IS NULL, contract_end
            LIMIT 30
            """,
            tuple(values),
        )
        items = rows_to_dicts(cursor, cursor.fetchall())
    return {"items": items, "count": len(items)}


def search_bids(args):
    keyword = getattr(args, "keyword", "") or ""
    hospital_id = getattr(args, "hospital_id", None)
    values = []
    where = []
    if keyword:
        like = f"%{keyword}%"
        where.append("(project_code LIKE ? OR supplier LIKE ? OR contract_no LIKE ?)")
        values.extend([like, like, like])
    if hospital_id:
        where.append("hospital_id = ?")
        values.append(hospital_id)
    clause = " AND ".join(where) if where else "1 = 1"
    with connect() as db:
        cursor = db.execute(
            f"""
            SELECT id, hospital_id, project_code, announcement_url, contract_url,
                   contract_amount, supplier, contract_no, publish_date, device_category,
                   supplier_category, stage
            FROM bid_wins
            WHERE {clause}
            ORDER BY publish_date DESC, id DESC
            LIMIT 30
            """,
            tuple(values),
        )
        items = rows_to_dicts(cursor, cursor.fetchall())
    return {"query": keyword, "items": items, "count": len(items)}


def add_incident(args):
    incident_id = getattr(args, "incident_id", None) or f"incident-{int(datetime.utcnow().timestamp())}"
    hospital = getattr(args, "hospital", None) or str(getattr(args, "hospital_id", "") or "")
    created_at = now_iso()
    with connect() as db:
        ensure_artifact_tables(db)
        db.execute(
            """
            INSERT OR REPLACE INTO service_incidents
              (incident_id, hospital, device, description, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (incident_id, hospital, getattr(args, "device", None), args.description, "created", created_at),
        )
    return {
        "created": True,
        "artifact": {"type": "service_incident", "id": incident_id, "status": "created"},
    }


def contract_intake(args):
    contract_id = args.contract_id
    schedule_id = schedule_id_for(contract_id)
    created_at = now_iso()
    with connect() as db:
        ensure_artifact_tables(db)
        db.execute(
            """
            INSERT INTO contract_intakes
              (contract_id, customer, device_model, service_period_start, service_period_end,
               maintenance_cycle, payment_terms, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(contract_id) DO UPDATE SET
              customer = excluded.customer,
              device_model = excluded.device_model,
              service_period_start = excluded.service_period_start,
              service_period_end = excluded.service_period_end,
              maintenance_cycle = excluded.maintenance_cycle,
              payment_terms = excluded.payment_terms,
              updated_at = excluded.updated_at
            """,
            (
                contract_id,
                args.customer,
                args.device_model,
                args.service_period_start,
                args.service_period_end,
                args.maintenance_cycle,
                getattr(args, "payment_terms", None),
                created_at,
                created_at,
            ),
        )
        db.execute(
            """
            INSERT INTO maintenance_schedules
              (schedule_id, contract_id, customer, device_model, cycle, next_run_at, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(schedule_id) DO UPDATE SET
              customer = excluded.customer,
              device_model = excluded.device_model,
              cycle = excluded.cycle,
              next_run_at = excluded.next_run_at,
              status = excluded.status,
              updated_at = excluded.updated_at
            """,
            (
                schedule_id,
                contract_id,
                args.customer,
                args.device_model,
                args.maintenance_cycle,
                args.service_period_start,
                "active",
                created_at,
                created_at,
            ),
        )
    return {
        "created": True,
        "artifacts": [
            {"type": "contract_intake", "id": contract_id, "status": "created"},
            {"type": "maintenance_schedule", "id": schedule_id, "status": "created"},
        ],
    }


def create_service_record(args):
    created_at = now_iso()
    with connect() as db:
        ensure_artifact_tables(db)
        db.execute(
            """
            INSERT OR REPLACE INTO service_records
              (record_id, contract_id, customer, device_model, service_date, diagnosis,
               parts_used, customer_signed, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                args.record_id,
                args.contract_id,
                args.customer,
                args.device_model,
                args.service_date,
                args.diagnosis,
                getattr(args, "parts_used", None),
                getattr(args, "customer_signed", None),
                created_at,
            ),
        )
    return {
        "created": True,
        "artifact": {"type": "service_record", "id": args.record_id, "status": "created"},
    }


def finance_settlement(args):
    created_at = now_iso()
    with connect() as db:
        ensure_artifact_tables(db)
        db.execute(
            """
            INSERT OR REPLACE INTO finance_settlements
              (settlement_id, contract_id, service_record_id, billing_amount, archive_status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                args.settlement_id,
                args.contract_id,
                args.service_record_id,
                getattr(args, "billing_amount", None),
                getattr(args, "archive_status", None),
                created_at,
            ),
        )
    return {
        "created": True,
        "artifact": {"type": "finance_settlement", "id": args.settlement_id, "status": "created"},
    }


def main(argv=None):
    parser = argparse.ArgumentParser(prog="med_crm.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    p_search = sub.add_parser("search_hospitals")
    p_search.add_argument("--keyword", required=True)
    p_search.set_defaults(handler=search_hospitals)

    p_global = sub.add_parser("global_search")
    p_global.add_argument("--keyword", required=True)
    p_global.set_defaults(handler=global_search)

    p_info = sub.add_parser("hospital_info")
    p_info.add_argument("--hospital-name", required=True)
    p_info.set_defaults(handler=hospital_info)

    p_devices = sub.add_parser("search_devices")
    p_devices.add_argument("--keyword", default="")
    p_devices.add_argument("--hospital-id", type=int)
    p_devices.set_defaults(handler=search_devices)

    p_maintenance = sub.add_parser("list_maintenance")
    p_maintenance.add_argument("--hospital-id", type=int)
    p_maintenance.add_argument("--expiring-before")
    p_maintenance.set_defaults(handler=list_maintenance)

    p_bids = sub.add_parser("search_bids")
    p_bids.add_argument("--keyword", default="")
    p_bids.add_argument("--hospital-id", type=int)
    p_bids.set_defaults(handler=search_bids)

    p_incident = sub.add_parser("add_incident")
    p_incident.add_argument("--incident-id")
    p_incident.add_argument("--hospital")
    p_incident.add_argument("--hospital-id")
    p_incident.add_argument("--device")
    p_incident.add_argument("--description", required=True)
    p_incident.set_defaults(handler=add_incident)

    p_contract = sub.add_parser("contract_intake")
    p_contract.add_argument("--contract-id", required=True)
    p_contract.add_argument("--customer", required=True)
    p_contract.add_argument("--device-model", required=True)
    p_contract.add_argument("--service-period-start", required=True)
    p_contract.add_argument("--service-period-end", required=True)
    p_contract.add_argument("--maintenance-cycle", required=True)
    p_contract.add_argument("--payment-terms")
    p_contract.set_defaults(handler=contract_intake)

    p_record = sub.add_parser("create_service_record")
    p_record.add_argument("--record-id", required=True)
    p_record.add_argument("--contract-id", required=True)
    p_record.add_argument("--customer", required=True)
    p_record.add_argument("--device-model", required=True)
    p_record.add_argument("--service-date", required=True)
    p_record.add_argument("--diagnosis", required=True)
    p_record.add_argument("--parts-used")
    p_record.add_argument("--customer-signed")
    p_record.set_defaults(handler=create_service_record)

    p_settlement = sub.add_parser("finance_settlement")
    p_settlement.add_argument("--settlement-id", required=True)
    p_settlement.add_argument("--contract-id", required=True)
    p_settlement.add_argument("--service-record-id", required=True)
    p_settlement.add_argument("--billing-amount")
    p_settlement.add_argument("--archive-status")
    p_settlement.set_defaults(handler=finance_settlement)

    args = parser.parse_args(argv)
    payload = args.handler(args)
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
