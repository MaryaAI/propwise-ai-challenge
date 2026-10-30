import { Migration } from '@mikro-orm/migrations';

export class Migration20261030094536 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "assistant_runs" ("id" uuid not null, "agency_id" uuid not null, "lead_id" uuid not null, "message_id" uuid not null, "created_by_id" uuid not null, "created_at" timestamptz not null, "parent_run_id" uuid null, "agent_message" text null, "trigger" text check ("trigger" in ('analysis', 'chat')) not null default 'analysis', "status" text check ("status" in ('completed', 'failed')) not null, "error" text null, "summary" text not null default '', "reply" text not null default '', "requirements" jsonb not null, "extraction" jsonb not null, "recommendations" jsonb not null, "trace" jsonb not null, "steps" jsonb not null, constraint "assistant_runs_pkey" primary key ("id"));`);
    this.addSql(`create index "assistant_runs_lead_id_created_at_index" on "assistant_runs" ("lead_id", "created_at");`);

    this.addSql(`create table "assistant_actions" ("id" uuid not null, "run_id" uuid not null, "type" text check ("type" in ('create_follow_up_task')) not null, "status" text check ("status" in ('pending_approval', 'approved', 'rejected')) not null default 'pending_approval', "title" varchar(255) not null, "notes" text null, "due_at" timestamptz null, "needs_clarification" text null, "task_id" uuid null, "decided_at" timestamptz null, "decided_by_id" uuid null, constraint "assistant_actions_pkey" primary key ("id"));`);
    this.addSql(`alter table "assistant_actions" add constraint "assistant_actions_task_id_unique" unique ("task_id");`);
    this.addSql(`create index "assistant_actions_run_id_index" on "assistant_actions" ("run_id");`);

    this.addSql(`alter table "assistant_runs" add constraint "assistant_runs_agency_id_foreign" foreign key ("agency_id") references "agencies" ("id") on update cascade;`);
    this.addSql(`alter table "assistant_runs" add constraint "assistant_runs_lead_id_foreign" foreign key ("lead_id") references "leads" ("id") on update cascade;`);
    this.addSql(`alter table "assistant_runs" add constraint "assistant_runs_message_id_foreign" foreign key ("message_id") references "messages" ("id") on update cascade;`);
    this.addSql(`alter table "assistant_runs" add constraint "assistant_runs_created_by_id_foreign" foreign key ("created_by_id") references "agents" ("id") on update cascade;`);
    this.addSql(`alter table "assistant_runs" add constraint "assistant_runs_parent_run_id_foreign" foreign key ("parent_run_id") references "assistant_runs" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "assistant_actions" add constraint "assistant_actions_run_id_foreign" foreign key ("run_id") references "assistant_runs" ("id") on update cascade;`);
    this.addSql(`alter table "assistant_actions" add constraint "assistant_actions_task_id_foreign" foreign key ("task_id") references "tasks" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "assistant_actions" add constraint "assistant_actions_decided_by_id_foreign" foreign key ("decided_by_id") references "agents" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "assistant_runs" drop constraint "assistant_runs_parent_run_id_foreign";`);

    this.addSql(`alter table "assistant_actions" drop constraint "assistant_actions_run_id_foreign";`);

    this.addSql(`drop table if exists "assistant_runs" cascade;`);

    this.addSql(`drop table if exists "assistant_actions" cascade;`);
  }

}
