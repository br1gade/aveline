-- Per-language title, hosts, venue name and address. Columns with a default:
-- existing rows read exactly as before, from the plain columns.

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "translations" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "venues" ADD COLUMN     "translations" JSONB NOT NULL DEFAULT '{}';

