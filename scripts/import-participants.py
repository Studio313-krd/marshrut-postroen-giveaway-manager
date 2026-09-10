"""Import account identities only; comments stay in the source workbook."""
import argparse
import hashlib
import json
import re
from pathlib import Path

import openpyxl

parser = argparse.ArgumentParser()
parser.add_argument("file", type=Path)
args = parser.parse_args()
workbook = openpyxl.load_workbook(args.file, read_only=True, data_only=True)
sheet = workbook["Участники"]
rows = iter(sheet.values)
headers = [str(value).strip() for value in next(rows)]
column = headers.index("Аккаунт")
accounts = []
seen = set()
for row_number, row in enumerate(rows, 2):
    if row[column] is None or not str(row[column]).strip():
        continue
    account = str(row[column]).strip().lstrip("@").lower()
    if not re.fullmatch(r"[a-z0-9._]{1,30}", account):
        raise ValueError(f"Invalid account in row {row_number}: {account!r}")
    if account in seen:
        raise ValueError(f"Duplicate account in row {row_number}: {account!r}")
    seen.add(account)
    accounts.append(account)
if not accounts:
    raise ValueError("The workbook has no participants")
result = {
    "sourceFile": args.file.name,
    "sourceHash": hashlib.sha256("\n".join(accounts).encode()).hexdigest(),
    "participants": accounts,
}
output = Path(__file__).resolve().parents[1] / "data" / "participants.json"
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Imported {len(accounts)} unique accounts into {output}")
