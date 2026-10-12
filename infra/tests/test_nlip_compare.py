#!/usr/bin/env python3
"""Sanity checks for the NLIP vs main Docker compare helper."""

from __future__ import annotations

import os
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
START = REPO_ROOT / "infra" / "scripts" / "start-nlip-compare.sh"
STOP = REPO_ROOT / "infra" / "scripts" / "stop-nlip-compare.sh"
COMPOSE = REPO_ROOT / "infra" / "docker" / "docker-compose.compare.yaml"
REALM = REPO_ROOT / "infra" / "keycloak" / "realms" / "realm-export.json"
GITIGNORE = REPO_ROOT / ".gitignore"


class NlipCompareDeployTests(unittest.TestCase):
    def test_scripts_are_executable_and_document_ports(self) -> None:
        self.assertTrue(START.is_file())
        self.assertTrue(STOP.is_file())
        self.assertTrue(os.access(START, os.X_OK), f"{START} must be executable")
        self.assertTrue(os.access(STOP, os.X_OK), f"{STOP} must be executable")

        help_text = subprocess.check_output([str(START), "--help"], text=True)
        self.assertIn("localhost:3000", help_text)
        self.assertIn("localhost:3100", help_text)
        self.assertIn("--skip-stack", help_text)
        self.assertIn("origin/main", help_text)
        self.assertNotIn("--wipe_data", help_text)

        stop_help = subprocess.check_output([str(STOP), "--help"], text=True)
        self.assertIn("3100", stop_help)

    def test_unknown_flag_is_rejected(self) -> None:
        result = subprocess.run(
            [str(START), "--not-a-real-flag"],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)

    def test_compose_overlay_is_baseline_frontend_only(self) -> None:
        text = COMPOSE.read_text(encoding="utf-8")
        self.assertIn("frontend-baseline:", text)
        self.assertIn("profiles: [compare]", text)
        self.assertIn("${BASELINE_FRONTEND_PORT:-3100}:3000", text)
        self.assertIn("ILLINOIS_CHAT_BASELINE_FRONTEND", text)
        # Overlay must not declare its own DB/IdP services (2-space keys).
        self.assertNotIn("\n  postgres-illinois-chat:", text)
        self.assertNotIn("\n  keycloak:", text)
        self.assertIn("no NLIP", text)

    def test_keycloak_realm_allows_baseline_origin(self) -> None:
        text = REALM.read_text(encoding="utf-8")
        self.assertIn("http://localhost:3100/", text)
        self.assertIn("http://localhost:3100/*", text)
        self.assertIn("http://127.0.0.1:3000/", text)
        self.assertIn("http://127.0.0.1:3000/*", text)

    def test_worktrees_are_gitignored(self) -> None:
        self.assertIn(".worktrees/", GITIGNORE.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
