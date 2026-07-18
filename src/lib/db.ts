import Dexie, { type Table } from 'dexie';

export interface DoseLog {
  id: string;
  substanceId: string;
  substanceName: string;
  categories: string[];
  amount: number;
  unit: string;
  route: string;
  timestamp: string;
  duration: string | null;
  notes: string | null;
  mood: number | null;
  setting: string | null;
  intensity: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubstanceRecord {
  id: string;
  data: string;
  createdAt: string;
  updatedAt: string;
}

export interface SettingsRecord {
  key: string;
  value: string;
  updatedAt: string;
}

class DrugucopiaDB extends Dexie {
  doses!: Table<DoseLog>;
  substances!: Table<SubstanceRecord>;
  settings!: Table<SettingsRecord>;

  constructor() {
    super('DrugucopiaDB');
    this.version(1).stores({
      doses: 'id, substanceId, timestamp, createdAt',
      substances: 'id, updatedAt',
      settings: 'key, updatedAt',
    });
  }
}

export const db = new DrugucopiaDB();

export async function initDB(): Promise<void> {
  await db.open().catch((err) => {
    console.error('Failed to open IndexedDB:', err);
  });
}

export async function closeDB(): Promise<void> {
  await db.close();
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.doses, db.substances, db.settings, async () => {
    await db.doses.clear();
    await db.substances.clear();
    await db.settings.clear();
  });
}

export async function getDoseCount(): Promise<number> {
  return db.doses.count();
}

export async function getAllDoses(): Promise<DoseLog[]> {
  return db.doses.orderBy('timestamp').reverse().toArray();
}

export async function addDose(dose: DoseLog): Promise<void> {
  await db.doses.add(dose);
}

export async function updateDose(id: string, updates: Partial<DoseLog>): Promise<number> {
  return db.doses.update(id, { ...updates, updatedAt: new Date().toISOString() });
}

export async function deleteDose(id: string): Promise<void> {
  await db.doses.delete(id);
}

export async function getSubstance(id: string): Promise<SubstanceRecord | undefined> {
  return db.substances.get(id);
}

export async function putSubstance(substance: SubstanceRecord): Promise<void> {
  await db.substances.put({
    ...substance,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteSubstance(id: string): Promise<void> {
  await db.substances.delete(id);
}

export async function getSetting(key: string): Promise<string | undefined> {
  const record = await db.settings.get(key);
  return record?.value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({
    key,
    value,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await db.settings.delete(key);
}