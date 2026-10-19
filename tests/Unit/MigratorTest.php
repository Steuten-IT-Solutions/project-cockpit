<?php

declare(strict_types=1);

namespace Cockpit\Tests\Unit;

use Cockpit\Database\Migrator;
use PHPUnit\Framework\TestCase;

final class MigratorTest extends TestCase
{
    public function testSplitsStatementsAndDropsComments(): void
    {
        $sql = "-- comment\nCREATE TABLE a (x INT);\n\n-- another\nCREATE TABLE b (\n  y INT\n);\n";

        self::assertSame(['CREATE TABLE a (x INT)', "CREATE TABLE b (\n  y INT\n)"], Migrator::statements($sql));
    }

    public function testInitialMigrationParsesIntoFiveTables(): void
    {
        $sql = (string)file_get_contents(dirname(__DIR__, 2) . '/migrations/0001_initial.sql');
        $statements = Migrator::statements($sql);

        self::assertCount(5, $statements);
        foreach ($statements as $statement) {
            self::assertStringStartsWith('CREATE TABLE', $statement);
        }
    }
}
