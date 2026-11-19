"""Reviewed chronological migration set for the disposable shared fixture.

The list is deliberately exact: adding, dropping or renaming a migration needs
a fixture review before browser acceptance can run against a different schema.
"""
from pathlib import Path


REVIEWED_MIGRATIONS = (
    '20261020180854_score_game_contracts.sql',
    '20261020221724_restrict_cleanup_execution.sql',
    '20261021062330_secure_show_rooms.sql',
    '20261021160821_secure_big_quiz_rooms.sql',
    '20261023094711_secure_throne_rooms.sql',
    '20261023132240_secure_party_rooms.sql',
    '20261023141309_retire_legacy_multiplayer.sql',
    '20261024070050_secure_race_rooms.sql',
    '20261024123525_readiness_score_contracts.sql',
    '20261024184826_private_host_lead_intake.sql',
    '20261116100000_secure_ruffled_rooms.sql',
    '20261118210000_secure_lantern_rooms.sql',
)


def reviewed_migrations(directory: Path) -> list[Path]:
    migrations = sorted(directory.glob('*.sql'))
    if tuple(path.name for path in migrations) != REVIEWED_MIGRATIONS:
        raise AssertionError('Review fixture order when migration set changes')
    return migrations
