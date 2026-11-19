"""Keep the shared browser fixture's reviewed schema boundary explicit."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent / 'gameplay_stack'))
from migration_order import REVIEWED_MIGRATIONS, reviewed_migrations


class MigrationOrderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        for name in reversed(REVIEWED_MIGRATIONS):
            (self.directory / name).write_text('-- synthetic migration\n')

    def tearDown(self):
        self.temp.cleanup()

    def test_reviewed_migrations_apply_in_chronological_order(self):
        self.assertEqual(tuple(path.name for path in reviewed_migrations(self.directory)),
                         REVIEWED_MIGRATIONS)
        self.assertEqual(REVIEWED_MIGRATIONS[-2:], (
            '20261116100000_secure_ruffled_rooms.sql',
            '20261118210000_secure_lantern_rooms.sql'))

    def test_unreviewed_migration_is_refused(self):
        (self.directory / '20261119000000_unreviewed.sql').write_text('-- synthetic\n')
        with self.assertRaisesRegex(AssertionError, 'Review fixture order'):
            reviewed_migrations(self.directory)

    def test_missing_migration_is_refused(self):
        (self.directory / REVIEWED_MIGRATIONS[0]).unlink()
        with self.assertRaisesRegex(AssertionError, 'Review fixture order'):
            reviewed_migrations(self.directory)

    def test_same_count_with_a_replaced_migration_is_refused(self):
        (self.directory / REVIEWED_MIGRATIONS[-1]).rename(self.directory / '20261118210000_other.sql')
        with self.assertRaisesRegex(AssertionError, 'Review fixture order'):
            reviewed_migrations(self.directory)

    def test_non_sql_readme_does_not_change_schema(self):
        (self.directory / 'README.md').write_text('Fixture notes\n')
        self.assertEqual(len(reviewed_migrations(self.directory)), len(REVIEWED_MIGRATIONS))


if __name__ == '__main__':
    unittest.main()
