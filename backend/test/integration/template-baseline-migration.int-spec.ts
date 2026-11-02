import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { TEST_DATABASE_URL } from '../setup/test-database';
import { assertTestDatabaseUrl } from '../../src/common/test-database-url';
import { buildInvitationContent, ContentTemplate } from '../../src/modules/invitations/invitation-content';
import { syntheticPreview } from '../../src/modules/design/synthetic-preview';
import { pinnedTemplate } from '../../src/modules/design/templates/template-content';
interface LegacyRow { invitation: { id: string; slug: string; status: 'DRAFT' | 'PUBLISHED' | 'CLOSED'; theme: object; expiresAt: null }; template: ContentTemplate; version?: ContentTemplate & { name: string; palettes: unknown } }
describe('populated legacy template migration', () => {
  const schema = `template_baseline_${randomUUID().replaceAll('-', '')}`; let client: Client;
  beforeAll(async () => {
    assertTestDatabaseUrl(TEST_DATABASE_URL); client = new Client({ connectionString: TEST_DATABASE_URL }); await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  });
  afterAll(async () => { if (client) { await client.query('ROLLBACK'); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); } });
  const serialize = (row: LegacyRow) => {
    const template = row.version ? pinnedTemplate({ template: row.template, templateVersion: row.version }) : row.template;
    return JSON.stringify(buildInvitationContent({ ...syntheticPreview(template), ...row.invitation, template }));
  };
  it('preserves exact legacy payloads and lifetime facts for every status, inactive/unused rows and odd JSON', async () => {
    const root = join(__dirname, '../../prisma/migrations'); const migrations = (await readdir(root)).filter((name) => /^\d/.test(name)).sort();
    for (const migration of migrations.filter((name) => name < '20261026110000_template_versions')) await client.query(await readFile(join(root, migration, 'migration.sql'), 'utf8'));
    await client.query(`INSERT INTO organizations(id,name,kind,"updatedAt") VALUES ('org','Legacy','HOST',now());
      INSERT INTO design_templates(id,key,name,"allowedFonts",palettes,"supportedBlocks","blockVariants","defaultTheme","isActive","updatedAt") VALUES
      ('used','legacy-odd','Odd',ARRAY['Odd Font','Inter'],'null','{}','{"HERO":["old-unknown","split"]}','{"primary":"#abc","font":"Odd Font","odd":null}',true,now()),
      ('unused','legacy-inactive','Inactive','{}','[{"key":"old","colors":[null,"#1"]}]','{}','{}','null',false,now());`);
    for (const [index, status] of ['DRAFT','PUBLISHED','CLOSED'].entries()) {
      await client.query(`INSERT INTO events(id,"organizationId",type,title,"hostsLabel","startsAt","updatedAt") VALUES ($1,'org','WEDDING','Legacy','A & B','2030-06-15',now())`, [`event${index}`]);
      await client.query(`INSERT INTO invitations(id,"eventId",slug,"templateId",theme,status,"updatedAt") VALUES ($1,$2,$3,'used','{"colors":["#1",null],"odd":null}',$4,now())`, [`inv${index}`,`event${index}`,`legacy-${index}`,status]);
    }
    const before = await client.query<LegacyRow>(`SELECT to_jsonb(i) AS invitation,to_jsonb(t) AS template FROM invitations i JOIN design_templates t ON t.id=i."templateId" ORDER BY i.id`);
    const expected = before.rows.map(serialize);
    for (const migration of migrations.filter((name) => name >= '20261026110000_template_versions')) {
      await client.query('BEGIN'); await client.query(await readFile(join(root, migration, 'migration.sql'), 'utf8')); await client.query('COMMIT');
    }
    const after = await client.query<LegacyRow>(`SELECT to_jsonb(i) AS invitation,to_jsonb(t) AS template,to_jsonb(v) AS version FROM invitations i JOIN design_templates t ON t.id=i."templateId" JOIN design_template_versions v ON v.id=i."templateVersionId" ORDER BY i.id`);
    expect(after.rows.map(serialize)).toEqual(expected);
    for (const [index, row] of after.rows.entries()) {
      for (const key of Object.keys(before.rows[index].invitation)) expect(row.invitation[key as keyof LegacyRow['invitation']]).toEqual(before.rows[index].invitation[key as keyof LegacyRow['invitation']]);
    }
    const facts = await client.query(`SELECT provenance,"publishedAt","publishedByUserId","allowedFonts",palettes,"supportedBlocks","defaultTheme" FROM design_template_versions ORDER BY "templateId"`);
    expect(facts.rowCount).toBe(2); expect(facts.rows.every((row: { provenance: string; publishedAt: null; publishedByUserId: null }) => row.provenance==='LEGACY_BASELINE' && row.publishedAt===null && row.publishedByUserId===null)).toBe(true);
    expect((await client.query(`SELECT count(*)::integer AS count FROM invitations WHERE "templateVersionId" IS NULL OR "organizationId"<>'org'`)).rows).toEqual([{ count: 0 }]);
  }, 90000);
});
