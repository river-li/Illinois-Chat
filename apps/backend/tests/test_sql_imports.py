"""The projects schema updater uses sqlalchemy.update; a missing import
makes every create-bot background task fail with NameError."""

import re
from pathlib import Path

SQL_PY = Path(__file__).resolve().parents[1] / "ai_ta_backend" / "database" / "sql.py"


def test_sqlalchemy_update_is_imported_in_sql_module():
    src = SQL_PY.read_text()
    assert re.search(r"from sqlalchemy import[^\n]*\bupdate\b", src)
