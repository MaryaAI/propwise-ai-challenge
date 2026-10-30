import { EntityManager } from '@mikro-orm/postgresql';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashPassword } from '../auth/password';
import {
  Agency,
  Agent,
  AssistantAction,
  AssistantRun,
  Lead,
  LeadSource,
  LeadStatus,
  Message,
  MessageChannel,
  MessageDirection,
  Property,
  PropertyStatus,
  PropertyType,
  Task,
  TaskStatus,
} from '../entities';
import { stableId } from './stable-id';

const SEED_DIR = join(__dirname, '..', '..', '..', 'seed');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface AgencySeed {
  key: string;
  name: string;
}
interface AgentSeed {
  key: string;
  agency: string;
  name: string;
  email: string;
  password: string;
  timezone: string;
}
interface PropertySeed {
  agency: string;
  reference: string;
  title: string;
  area: string;
  building: string | null;
  type: PropertyType;
  bedrooms: number;
  bathrooms: number;
  sizeSqft: number;
  priceAed: number;
  annualRentAed: number | null;
  serviceChargeAedPerSqft: number | null;
  status: PropertyStatus;
  listedDaysAgo: number;
  description: string;
}
interface LeadSeed {
  key: string;
  agency: string;
  assignedAgent: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  source: LeadSource;
  status: LeadStatus;
  notes: string | null;
  createdMinutesAgo: number;
  messages: { direction: MessageDirection; channel: MessageChannel; minutesAgo: number; body: string }[];
  tasks: { title: string; notes: string | null; dueInMinutes: number | null; status: TaskStatus }[];
}

function readSeed<T>(file: string): T {
  return JSON.parse(readFileSync(join(SEED_DIR, file), 'utf8')) as T;
}

/**
 * Replaces all data with the files in /seed. Times are relative to `now`, so a fresh seed
 * always has a message from "18 minutes ago".
 */
export async function seed(em: EntityManager, now: Date = new Date()): Promise<void> {
  const agencies = readSeed<AgencySeed[]>('agencies.json');
  const agents = readSeed<AgentSeed[]>('agents.json');
  const properties = readSeed<PropertySeed[]>('properties.json');
  const leads = readSeed<LeadSeed[]>('leads.json');
  const passwordHashes = new Map<string, string>();
  for (const agent of agents) passwordHashes.set(agent.key, await hashPassword(agent.password));

  const ago = (ms: number) => new Date(now.getTime() - ms);

  await em.transactional(async (tx) => {
    await tx.nativeDelete(AssistantAction, {});
    await tx.nativeDelete(AssistantRun, {});
    await tx.nativeDelete(Task, {});
    await tx.nativeDelete(Message, {});
    await tx.nativeDelete(Lead, {});
    await tx.nativeDelete(Property, {});
    await tx.nativeDelete(Agent, {});
    await tx.nativeDelete(Agency, {});

    for (const agency of agencies) {
      tx.create(Agency, { id: stableId('agency', agency.key), name: agency.name, createdAt: ago(365 * DAY) });
    }

    for (const agent of agents) {
      tx.create(Agent, {
        id: stableId('agent', agent.key),
        agency: tx.getReference(Agency, stableId('agency', agent.agency)),
        name: agent.name,
        email: agent.email,
        passwordHash: passwordHashes.get(agent.key)!,
        timezone: agent.timezone,
        createdAt: ago(300 * DAY),
      });
    }

    for (const property of properties) {
      tx.create(Property, {
        id: stableId('property', property.reference),
        agency: tx.getReference(Agency, stableId('agency', property.agency)),
        reference: property.reference,
        title: property.title,
        area: property.area,
        building: property.building,
        type: property.type,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        sizeSqft: property.sizeSqft,
        priceAed: property.priceAed,
        annualRentAed: property.annualRentAed,
        serviceChargeAedPerSqft: property.serviceChargeAedPerSqft,
        status: property.status,
        description: property.description,
        listedAt: ago(property.listedDaysAgo * DAY),
      });
    }

    for (const lead of leads) {
      const leadId = stableId('lead', lead.key);
      const lastActivity = Math.min(lead.createdMinutesAgo, ...lead.messages.map((m) => m.minutesAgo));
      const leadEntity = tx.create(Lead, {
        id: leadId,
        agency: tx.getReference(Agency, stableId('agency', lead.agency)),
        assignedAgent: lead.assignedAgent ? tx.getReference(Agent, stableId('agent', lead.assignedAgent)) : null,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        source: lead.source,
        status: lead.status,
        notes: lead.notes,
        createdAt: ago(lead.createdMinutesAgo * MINUTE),
        updatedAt: ago(lastActivity * MINUTE),
      });

      lead.messages.forEach((message, index) => {
        tx.create(Message, {
          id: stableId('message', `${lead.key}:${index}`),
          lead: leadEntity,
          direction: message.direction,
          channel: message.channel,
          body: message.body,
          sentAt: ago(message.minutesAgo * MINUTE),
        });
      });

      lead.tasks.forEach((task, index) => {
        tx.create(Task, {
          id: stableId('task', `${lead.key}:${index}`),
          agency: leadEntity.agency,
          lead: leadEntity,
          title: task.title,
          notes: task.notes,
          dueAt: task.dueInMinutes === null ? null : new Date(now.getTime() + task.dueInMinutes * MINUTE),
          status: task.status,
          createdBy: leadEntity.assignedAgent ?? tx.getReference(Agent, stableId('agent', 'sara')),
          createdAt: ago(lead.createdMinutesAgo * MINUTE),
        });
      });
    }
  });
}
