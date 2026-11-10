import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEGACY_DB_FILE = path.join(__dirname, '.syndicate-online-db.json');
const DB_FILE = path.join(__dirname, '.syndicate-online-db-v2.json');

// Remove legacy pre-seeded DB if present
try {
  if (fs.existsSync(LEGACY_DB_FILE)) {
    fs.unlinkSync(LEGACY_DB_FILE);
  }
} catch {
  // Ignore cleanup errors
}

export interface FamilyUpgrades {
  kevlar_tailors: number;
  hollow_points: number;
  deadeye_drills: number;
  speakeasy_skim: number;
  [key: string]: number;
}

export type MafiaRank = 'DON' | 'UNDERBOSS' | 'CONSIGLIERE' | 'CAPO' | 'SOLDIER' | 'STREET_THUG';

export interface FamilyMemberRecord {
  userId: string;
  username: string;
  rank: MafiaRank;
  power: number;
  joinedAt: number;
  contributions: number;
}

export interface MafiaFamily {
  id: string;
  name: string;
  tag: string;
  color: string;
  crestBg: string;
  motto: string;
  founderName: string;
  founderId?: string;
  members: number;
  memberList: FamilyMemberRecord[];
  respect: number;
  turfCount: number;
  upgrades: FamilyUpgrades;
}

export interface TurfDistrict {
  id: string;
  name: string;
  controllingFamilyId: string;
  controlPct: number;
  bonusDesc: string;
  dangerLevel: string;
}

export interface RaidBossState {
  id: string;
  name: string;
  title: string;
  hp: number;
  maxHp: number;
  tier: number;
  rewardGold: number;
  rewardGems: number;
  topContributors: Record<string, number>;
}

export interface ChatMessage {
  id: string;
  sender: string;
  familyTag: string;
  channel: 'global' | 'family' | 'system';
  text: string;
  timestamp: number;
}

export interface WeaponStatRecord {
  picks: number;
  wins: number;
  totalStages: number;
}

export interface MetaBalanceState {
  seasonNote: string;
  weaponMultipliers: Record<string, number>;
  weaponStats: Record<string, WeaponStatRecord>;
  skillPickCounts: Record<string, number>;
  diminishingReturnsInfo: string;
  skillRegulation: {
    projectileCapDamping: number;
    attackSpeedSoftCap: number;
    enemyAdaptiveArmor: number;
  };
  lastUpdated: number;
}

export interface UserAccount {
  id: string;
  username: string;
  usernameLower: string;
  passwordHash: string;
  salt: string;
  token: string;
  power: number;
  highestWorld: number;
  highestStage: number;
  familyId: string;
  familyTag: string;
  familyRank: MafiaRank | '';
  createdAt: number;
  lastSeen: number;
  savedMeta?: Record<string, unknown> | null;
}

export interface LeaderboardEntry {
  username: string;
  familyTag: string;
  power: number;
  stage: string;
}

interface OnlineDatabase {
  schemaVersion: number;
  users: Record<string, UserAccount>;
  families: MafiaFamily[];
  turfWars: TurfDistrict[];
  raidBoss: RaidBossState;
  chatHistory: ChatMessage[];
  metaBalance: MetaBalanceState;
}

const INITIAL_DB: OnlineDatabase = {
  schemaVersion: 2,
  users: {},
  families: [],
  turfWars: [
    {
      id: 'turf_docks',
      name: 'Little Italy Docks',
      controllingFamilyId: '',
      controlPct: 0,
      bonusDesc: '+4% Syndicate Cash Skim',
      dangerLevel: 'Tier I Racket'
    },
    {
      id: 'turf_speakeasy',
      name: 'Bronzeville Speakeasy Strip',
      controllingFamilyId: '',
      controlPct: 0,
      bonusDesc: '+3% Firearm Fire Rate',
      dangerLevel: 'Tier II Racket'
    },
    {
      id: 'turf_railyard',
      name: "Hell's Kitchen Freight Yards",
      controllingFamilyId: '',
      controlPct: 0,
      bonusDesc: '+4% Kevlar Armor Integrity',
      dangerLevel: 'Tier III Racket'
    },
    {
      id: 'turf_casino',
      name: 'Grand Casino Promenade',
      controllingFamilyId: '',
      controlPct: 0,
      bonusDesc: '+3% Deadeye Crit Impact',
      dangerLevel: 'Tier IV Racket'
    },
    {
      id: 'turf_vaults',
      name: 'Federal Reserve Vault Row',
      controllingFamilyId: '',
      controlPct: 0,
      bonusDesc: '+5% Underboss Bounty',
      dangerLevel: 'Tier V Racket'
    }
  ],
  raidBoss: {
    id: 'raid_boss_1',
    name: "DON CASTELLANO'S ARMORED DREADNOUGHT",
    title: 'Commission Raid Boss · Tier I',
    hp: 250000,
    maxHp: 250000,
    tier: 1,
    rewardGold: 600,
    rewardGems: 45,
    topContributors: {}
  },
  chatHistory: [],
  metaBalance: {
    seasonNote:
      'Commission Equilibrium Engine v4.0: All 7 Syndicate weapons are calibrated to 100% baseline DPS parity. Live telemetry dynamically tunes multipliers between 0.92x and 1.12x as runs are completed.',
    weaponMultipliers: {
      bow: 1.0,
      chakram: 1.0,
      crossbow: 1.0,
      staff: 1.0,
      s_weapon_tommy: 1.0,
      weapon_vendetta: 1.0,
      weapon_viper_duals: 1.0
    },
    weaponStats: {
      bow: { picks: 0, wins: 0, totalStages: 0 },
      chakram: { picks: 0, wins: 0, totalStages: 0 },
      crossbow: { picks: 0, wins: 0, totalStages: 0 },
      staff: { picks: 0, wins: 0, totalStages: 0 },
      s_weapon_tommy: { picks: 0, wins: 0, totalStages: 0 },
      weapon_vendetta: { picks: 0, wins: 0, totalStages: 0 },
      weapon_viper_duals: { picks: 0, wins: 0, totalStages: 0 }
    },
    skillPickCounts: {},
    diminishingReturnsInfo:
      'Stacking >4 identical projectile/elemental techniques triggers enemy Kevlar counter-plating (up to 14% adaptive resistance), ensuring no single skill stack can cheese the game.',
    skillRegulation: {
      projectileCapDamping: 0.82,
      attackSpeedSoftCap: 2.1,
      enemyAdaptiveArmor: 0.14
    },
    lastUpdated: Date.now()
  }
};

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function loadDb(): OnlineDatabase {
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (parsed && parsed.schemaVersion === 2) {
        const families: MafiaFamily[] = (Array.isArray(parsed.families) ? parsed.families : []).map((f: any) => {
          if (!Array.isArray(f.memberList)) {
            f.memberList = [];
            if (f.founderName) {
              f.memberList.push({
                userId: f.founderId || ('usr_' + f.founderName.toLowerCase()),
                username: f.founderName,
                rank: 'DON',
                power: 65,
                joinedAt: Date.now(),
                contributions: 250
              });
            }
          }
          return f as MafiaFamily;
        });
        return {
          ...INITIAL_DB,
          ...parsed,
          users: parsed.users || {},
          families,
          turfWars: Array.isArray(parsed.turfWars) ? parsed.turfWars : INITIAL_DB.turfWars,
          chatHistory: Array.isArray(parsed.chatHistory) ? parsed.chatHistory : [],
          metaBalance: {
            ...INITIAL_DB.metaBalance,
            ...(parsed.metaBalance || {}),
            weaponMultipliers: {
              ...INITIAL_DB.metaBalance.weaponMultipliers,
              ...(parsed.metaBalance?.weaponMultipliers || {})
            },
            weaponStats: {
              ...INITIAL_DB.metaBalance.weaponStats,
              ...(parsed.metaBalance?.weaponStats || {})
            }
          }
        };
      }
    }
  } catch {
    // Fallback to clean INITIAL_DB
  }
  return structuredClone(INITIAL_DB);
}

const db: OnlineDatabase = loadDb();

function saveDb(): void {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch {
    // Ignore write errors
  }
}

function recalculateTurfCounts(): void {
  for (const fam of db.families) {
    fam.turfCount = db.turfWars.filter((t: TurfDistrict) => t.controllingFamilyId === fam.id).length;
  }
}

function recomputeMetaBalanceMultipliers(): void {
  const stats = db.metaBalance.weaponStats;
  const weaponIds = Object.keys(stats);
  let totalPicks = 0;
  let totalWins = 0;
  for (const id of weaponIds) {
    totalPicks += stats[id].picks;
    totalWins += stats[id].wins;
  }

  // Until at least 5 real runs are logged across the server, keep all weapons at 1.00x parity
  if (totalPicks < 5) {
    for (const id of weaponIds) {
      db.metaBalance.weaponMultipliers[id] = 1.0;
    }
    db.metaBalance.lastUpdated = Date.now();
    return;
  }

  const avgPickShare = 1 / Math.max(1, weaponIds.length);
  const globalWinRate = totalWins / Math.max(1, totalPicks);

  for (const id of weaponIds) {
    const st = stats[id];
    if (st.picks === 0) {
      // Slight underdog buff for unpicked weapons once runs are active
      db.metaBalance.weaponMultipliers[id] = 1.04;
      continue;
    }
    const pickShare = st.picks / totalPicks;
    const winRate = st.wins / st.picks;

    const pickDelta = avgPickShare - pickShare;
    const winDelta = globalWinRate - winRate;
    const rawAdj = 1.0 + pickDelta * 0.35 + winDelta * 0.28;
    const clamped = Math.max(0.92, Math.min(1.12, Math.round(rawAdj * 100) / 100));
    db.metaBalance.weaponMultipliers[id] = clamped;
  }
  db.metaBalance.lastUpdated = Date.now();
}

function getLeaderboard(): LeaderboardEntry[] {
  return Object.values(db.users)
    .map((u: UserAccount) => {
      const fam = db.families.find((f: MafiaFamily) => f.id === u.familyId);
      return {
        username: u.username,
        familyTag: fam ? fam.tag : 'SOLO',
        power: u.power || 150,
        stage: `T${u.highestWorld || 1}-B${u.highestStage || 1}`
      };
    })
    .sort((a, b) => b.power - a.power)
    .slice(0, 30);
}

recalculateTurfCounts();
recomputeMetaBalanceMultipliers();

const RAID_BOSS_ROTATION = [
  { name: "DON CASTELLANO'S ARMORED DREADNOUGHT", title: 'Commission Raid Boss · Tier I', baseHp: 250000 },
  { name: "EL CAPITÁN'S IRONCLAD GUNBOAT", title: 'Smuggler Armada Boss · Tier II', baseHp: 320000 },
  { name: 'THE FEDERAL UNTOUCHABLE TANK', title: 'Treasury Siege Boss · Tier III', baseHp: 400000 },
  { name: 'SUPREME CONSIGLIERE MALATESTA', title: 'Citadel Kingpin Boss · Tier IV', baseHp: 500000 }
];

const FAMILY_CREST_PALETTES = [
  { color: '#dc2626', crestBg: 'linear-gradient(180deg, #991b1b, #450a0a)' },
  { color: '#eab308', crestBg: 'linear-gradient(180deg, #854d0e, #422006)' },
  { color: '#38bdf8', crestBg: 'linear-gradient(180deg, #1e40af, #0f172a)' },
  { color: '#10b981', crestBg: 'linear-gradient(180deg, #065f46, #022c22)' },
  { color: '#a855f7', crestBg: 'linear-gradient(180deg, #581c87, #2e1065)' }
];

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  // Enable Cross-Origin Resource Sharing (CORS) for external platforms (e.g. Itch.io HTML5 ZIP embeds)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  interface ConnectedClient {
    ws: WebSocket;
    playerName: string;
    familyId: string;
    familyTag: string;
    power: number;
  }

  const clients = new Map<WebSocket, ConnectedClient>();

  function getOnlineSyndicateCount(): number {
    return Math.max(1, clients.size);
  }

  function getBootstrapPayload() {
    recalculateTurfCounts();
    return {
      onlineCount: getOnlineSyndicateCount(),
      families: db.families,
      turfWars: db.turfWars,
      raidBoss: db.raidBoss,
      chatHistory: db.chatHistory.slice(-40),
      metaBalance: db.metaBalance,
      leaderboard: getLeaderboard()
    };
  }

  function broadcast(payload: Record<string, unknown>): void {
    const raw = JSON.stringify(payload);
    for (const [clientWs] of clients) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(raw);
      }
    }
  }

  // ==========================================
  // ACCOUNT CREATOR & AUTHENTICATION ROUTES
  // ==========================================
  app.post('/api/auth/register', (req, res) => {
    const { username, password } = req.body || {};
    const cleanName = String(username || '')
      .trim()
      .replace(/[^a-zA-Z0-9_\-. ]/g, '')
      .slice(0, 18);
    const rawPass = String(password || '');

    if (cleanName.length < 3) {
      res.status(400).json({ error: 'Name must be between 3 and 18 characters.' });
      return;
    }
    if (rawPass.length < 4) {
      res.status(400).json({ error: 'Password must be at least 4 characters.' });
      return;
    }

    const nameKey = cleanName.toLowerCase();
    if (db.users[nameKey]) {
      res.status(400).json({ error: 'That Syndicate name is already registered. Please sign in or pick another name.' });
      return;
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(rawPass, salt);
    const token = crypto.randomBytes(24).toString('hex');

    const newUser: UserAccount = {
      id: 'usr_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex'),
      username: cleanName,
      usernameLower: nameKey,
      passwordHash,
      salt,
      token,
      power: 65,
      highestWorld: 1,
      highestStage: 1,
      familyId: '',
      familyTag: 'SOLO',
      familyRank: '',
      createdAt: Date.now(),
      lastSeen: Date.now(),
      savedMeta: null
    };

    db.users[nameKey] = newUser;

    const welcomeMsg: ChatMessage = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      sender: 'COMMISSION_WIRE',
      familyTag: 'SYN',
      channel: 'system',
      text: `${cleanName} registered a new Hitman dossier and entered the streets from zero.`,
      timestamp: Date.now()
    };
    db.chatHistory.push(welcomeMsg);
    if (db.chatHistory.length > 60) db.chatHistory.shift();
    saveDb();

    broadcast({ type: 'chat:message', message: welcomeMsg });
    broadcast({ type: 'leaderboard:updated', leaderboard: getLeaderboard() });

    const userSummary = {
      id: newUser.id,
      username: newUser.username,
      familyId: newUser.familyId,
      familyTag: newUser.familyTag,
      familyRank: newUser.familyRank || '',
      power: newUser.power,
      highestWorld: newUser.highestWorld,
      highestStage: newUser.highestStage,
      savedMeta: newUser.savedMeta || null
    };

    res.json({
      ok: true,
      token,
      user: userSummary,
      profile: userSummary,
      bootstrap: getBootstrapPayload()
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const cleanName = String(username || '').trim();
    const rawPass = String(password || '');
    const nameKey = cleanName.toLowerCase();

    const existing = db.users[nameKey];
    if (!existing) {
      res.status(401).json({ error: 'No account found with that name. Switch to Create Account to register!' });
      return;
    }

    const attemptedHash = hashPassword(rawPass, existing.salt);
    if (attemptedHash !== existing.passwordHash) {
      res.status(401).json({ error: 'Incorrect password for this Syndicate account.' });
      return;
    }

    existing.token = crypto.randomBytes(24).toString('hex');
    existing.lastSeen = Date.now();
    saveDb();

    const fam = db.families.find((f: MafiaFamily) => f.id === existing.familyId);
    existing.familyTag = fam ? fam.tag : 'SOLO';
    if (!existing.familyRank && fam) {
      existing.familyRank = (fam.founderName === existing.username || fam.founderId === existing.id) ? 'DON' : 'STREET_THUG';
    }

    const userSummary = {
      id: existing.id,
      username: existing.username,
      familyId: existing.familyId,
      familyTag: existing.familyTag,
      familyRank: existing.familyRank || '',
      power: existing.power,
      highestWorld: existing.highestWorld,
      highestStage: existing.highestStage,
      savedMeta: existing.savedMeta || null
    };

    res.json({
      ok: true,
      token: existing.token,
      user: userSummary,
      profile: userSummary,
      bootstrap: getBootstrapPayload()
    });
  });

  const handleSessionCheck = (req: any, res: any) => {
    const token = (req.body && req.body.token) || (req.query && req.query.token);
    if (!token || typeof token !== 'string') {
      res.status(401).json({ error: 'No session token' });
      return;
    }
    const found = Object.values(db.users).find((u: UserAccount) => u.token === token);
    if (!found) {
      res.status(401).json({ error: 'Session expired or invalid' });
      return;
    }
    found.lastSeen = Date.now();
    const fam = db.families.find((f: MafiaFamily) => f.id === found.familyId);
    found.familyTag = fam ? fam.tag : 'SOLO';
    if (!found.familyRank && fam) {
      found.familyRank = (fam.founderName === found.username || fam.founderId === found.id) ? 'DON' : 'STREET_THUG';
    }

    const userSummary = {
      id: found.id,
      username: found.username,
      familyId: found.familyId,
      familyTag: found.familyTag,
      familyRank: found.familyRank || '',
      power: found.power,
      highestWorld: found.highestWorld,
      highestStage: found.highestStage,
      savedMeta: found.savedMeta || null
    };

    res.json({
      ok: true,
      user: userSummary,
      profile: userSummary,
      bootstrap: getBootstrapPayload()
    });
  };

  app.post('/api/auth/session', handleSessionCheck);
  app.get('/api/auth/session', handleSessionCheck);

  app.post('/api/auth/sync', (req, res) => {
    const { token, power, highestWorld, highestStage, familyId, savedMeta } = req.body || {};
    if (!token || typeof token !== 'string') {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const found = Object.values(db.users).find((u: UserAccount) => u.token === token);
    if (!found) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }
    if (typeof power === 'number' && !Number.isNaN(power)) {
      found.power = Math.max(50, Math.round(power));
    }
    if (typeof highestWorld === 'number') {
      found.highestWorld = Math.max(found.highestWorld || 1, Math.round(highestWorld));
    }
    if (typeof highestStage === 'number') {
      found.highestStage = Math.max(1, Math.round(highestStage));
    }
    if (typeof familyId === 'string') {
      found.familyId = familyId;
      const fam = db.families.find((f: MafiaFamily) => f.id === familyId);
      found.familyTag = fam ? fam.tag : 'SOLO';
    }
    if (savedMeta && typeof savedMeta === 'object') {
      found.savedMeta = savedMeta as Record<string, unknown>;
    }
    found.lastSeen = Date.now();
    saveDb();

    res.json({
      ok: true,
      leaderboard: getLeaderboard()
    });
  });

  // ==========================================
  // ONLINE SYNDICATE, FAMILY, WAR & BOSS ROUTES
  // ==========================================
  app.get('/api/online/bootstrap', (_req, res) => {
    res.json(getBootstrapPayload());
  });

  app.post('/api/family/join', (req, res) => {
    const { familyId, tag, playerName, token } = req.body || {};
    const fam = db.families.find((f: MafiaFamily) => f.id === familyId || (tag && f.tag === tag) || (familyId && f.tag === familyId));
    if (!fam) {
      res.status(404).json({ error: 'Family not found' });
      return;
    }
    if (!Array.isArray(fam.memberList)) fam.memberList = [];

    const usr = token ? Object.values(db.users).find((u: UserAccount) => u.token === token) : null;
    const effectiveName = usr ? usr.username : String(playerName || 'Hitman');
    const effectiveId = usr ? usr.id : ('usr_' + effectiveName.toLowerCase());

    if (usr) {
      if (usr.familyId && usr.familyId !== fam.id) {
        const prevFam = db.families.find((f: MafiaFamily) => f.id === usr.familyId);
        if (prevFam && Array.isArray(prevFam.memberList)) {
          prevFam.memberList = prevFam.memberList.filter(m => m.userId !== usr.id && m.username !== usr.username);
          prevFam.members = prevFam.memberList.length;
        }
      }
      usr.familyId = fam.id;
      usr.familyTag = fam.tag;
      usr.familyRank = 'STREET_THUG'; // New recruits join as Street Thugs
    }

    // Upsert into family member roster as Street Thug
    fam.memberList = fam.memberList.filter(m => m.userId !== effectiveId && m.username !== effectiveName);
    fam.memberList.push({
      userId: effectiveId,
      username: effectiveName,
      rank: 'STREET_THUG',
      power: usr ? (usr.power || 65) : 65,
      joinedAt: Date.now(),
      contributions: 0
    });
    fam.members = fam.memberList.length;
    fam.respect += 45;
    saveDb();

    const sysMsg: ChatMessage = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      sender: 'COMMISSION_WIRE',
      familyTag: fam.tag,
      channel: 'system',
      text: `🩸 ${effectiveName} took the Omertà blood oath as a Street Thug in [${fam.tag}] ${fam.name}!`,
      timestamp: Date.now()
    };
    db.chatHistory.push(sysMsg);
    if (db.chatHistory.length > 60) db.chatHistory.shift();

    broadcast({ type: 'family:updated', families: db.families, message: sysMsg, leaderboard: getLeaderboard() });
    res.json({ ok: true, family: fam, families: db.families, leaderboard: getLeaderboard() });
  });

  app.post('/api/family/create', (req, res) => {
    const { name, tag, motto, founderName, token } = req.body || {};
    const usr = token ? Object.values(db.users).find((u: UserAccount) => u.token === token) : null;
    const cleanName = String(name || '').trim().slice(0, 26);
    const cleanTag = String(tag || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4);

    if (cleanName.length < 3 || cleanTag.length < 2) {
      res.status(400).json({ error: 'Family name (3+ chars) and tag (2-4 chars) required.' });
      return;
    }

    if (db.families.some((f: MafiaFamily) => f.name.toLowerCase() === cleanName.toLowerCase() || f.tag === cleanTag)) {
      res.status(400).json({ error: 'A Crime Family with that name or tag already exists.' });
      return;
    }

    const effectiveFounder = usr ? usr.username : String(founderName || 'Don').trim();
    const effectiveFounderId = usr ? usr.id : ('usr_' + effectiveFounder.toLowerCase());

    if (usr && usr.familyId) {
      const prevFam = db.families.find((f: MafiaFamily) => f.id === usr.familyId);
      if (prevFam && Array.isArray(prevFam.memberList)) {
        prevFam.memberList = prevFam.memberList.filter(m => m.userId !== usr.id && m.username !== usr.username);
        prevFam.members = prevFam.memberList.length;
      }
    }

    const palette = FAMILY_CREST_PALETTES[db.families.length % FAMILY_CREST_PALETTES.length];
    const newFam: MafiaFamily = {
      id: 'fam_' + Date.now().toString(36),
      name: cleanName,
      tag: cleanTag,
      color: palette.color,
      crestBg: palette.crestBg,
      motto: String(motto || `Founded by Don ${effectiveFounder}.`).trim().slice(0, 64),
      founderName: effectiveFounder,
      founderId: effectiveFounderId,
      members: 1,
      memberList: [
        {
          userId: effectiveFounderId,
          username: effectiveFounder,
          rank: 'DON', // Founder instantly becomes DON
          power: usr ? (usr.power || 65) : 65,
          joinedAt: Date.now(),
          contributions: 250
        }
      ],
      respect: 250,
      turfCount: 0,
      upgrades: { kevlar_tailors: 1, hollow_points: 1, deadeye_drills: 1, speakeasy_skim: 1 }
    };
    db.families.push(newFam);

    if (usr) {
      usr.familyId = newFam.id;
      usr.familyTag = newFam.tag;
      usr.familyRank = 'DON';
    }

    const sysMsg: ChatMessage = {
      id: 'msg_' + Date.now(),
      sender: 'COMMISSION_WIRE',
      familyTag: newFam.tag,
      channel: 'system',
      text: `👑 Don ${effectiveFounder} crowned DON of the new [${newFam.tag}] ${newFam.name} Crime Family!`,
      timestamp: Date.now()
    };
    db.chatHistory.push(sysMsg);
    if (db.chatHistory.length > 60) db.chatHistory.shift();

    saveDb();

    broadcast({ type: 'family:updated', families: db.families, leaderboard: getLeaderboard() });
    broadcast({ type: 'chat:message', message: sysMsg });
    res.json({ ok: true, family: newFam, families: db.families, leaderboard: getLeaderboard() });
  });

  // Promote Member: Don or Underboss can promote lower ranks along the Mafia ladder
  app.post('/api/family/promote', (req, res) => {
    const { token, targetUserId, targetUsername } = req.body || {};
    const caller = token ? Object.values(db.users).find((u: UserAccount) => u.token === token) : null;
    if (!caller || !caller.familyId) {
      res.status(401).json({ error: 'You must belong to a Family to promote members.' });
      return;
    }
    const fam = db.families.find((f: MafiaFamily) => f.id === caller.familyId);
    if (!fam || !Array.isArray(fam.memberList)) {
      res.status(404).json({ error: 'Family not found.' });
      return;
    }

    const callerMem = fam.memberList.find(m => m.userId === caller.id || m.username === caller.username);
    const callerRank = callerMem ? callerMem.rank : (caller.familyRank || 'STREET_THUG');
    if (callerRank !== 'DON' && callerRank !== 'UNDERBOSS') {
      res.status(403).json({ error: 'Only the Don or Underboss has authority to promote members.' });
      return;
    }

    const targetMem = fam.memberList.find(m => m.userId === targetUserId || m.username === targetUserId || (targetUsername && m.username === targetUsername));
    if (!targetMem) {
      res.status(404).json({ error: 'Member not found in family roster.' });
      return;
    }

    const ladder: MafiaRank[] = ['STREET_THUG', 'SOLDIER', 'CAPO', 'CONSIGLIERE', 'UNDERBOSS'];
    const curIdx = ladder.indexOf(targetMem.rank);
    if (curIdx === -1 || curIdx >= ladder.length - 1) {
      res.status(400).json({ error: `${targetMem.username} is already at the highest appointable rank.` });
      return;
    }
    if (callerRank === 'UNDERBOSS' && curIdx >= 2) {
      res.status(403).json({ error: 'Underbosses can only promote up to Caporegime. Only the Don appoints Consiglieres and Underbosses.' });
      return;
    }

    const nextRank = ladder[curIdx + 1];
    targetMem.rank = nextRank;
    const targetUsr = Object.values(db.users).find((u: UserAccount) => u.id === targetUserId);
    if (targetUsr) targetUsr.familyRank = nextRank;
    saveDb();

    const rankTitles: Record<MafiaRank, string> = {
      DON: 'Don',
      UNDERBOSS: 'Underboss',
      CONSIGLIERE: 'Consigliere',
      CAPO: 'Caporegime (Capo)',
      SOLDIER: 'Soldier (Made Man)',
      STREET_THUG: 'Street Thug'
    };

    const sysMsg: ChatMessage = {
      id: 'msg_' + Date.now(),
      sender: 'COMMISSION_WIRE',
      familyTag: fam.tag,
      channel: 'system',
      text: `⭐ ${caller.username} promoted ${targetMem.username} to ${rankTitles[nextRank]} in [${fam.tag}]!`,
      timestamp: Date.now()
    };
    db.chatHistory.push(sysMsg);
    if (db.chatHistory.length > 60) db.chatHistory.shift();

    broadcast({ type: 'family:updated', families: db.families, message: sysMsg, leaderboard: getLeaderboard() });
    res.json({ ok: true, family: fam, families: db.families });
  });

  // Demote Member: Don can demote any rank below Don
  app.post('/api/family/demote', (req, res) => {
    const { token, targetUserId, targetUsername } = req.body || {};
    const caller = token ? Object.values(db.users).find((u: UserAccount) => u.token === token) : null;
    if (!caller || !caller.familyId) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }
    const fam = db.families.find((f: MafiaFamily) => f.id === caller.familyId);
    if (!fam || !Array.isArray(fam.memberList)) {
      res.status(404).json({ error: 'Family not found.' });
      return;
    }

    const callerMem = fam.memberList.find(m => m.userId === caller.id || m.username === caller.username);
    const callerRank = callerMem ? callerMem.rank : (caller.familyRank || 'STREET_THUG');
    if (callerRank !== 'DON') {
      res.status(403).json({ error: 'Only the Don has authority to demote Made Men.' });
      return;
    }

    const targetMem = fam.memberList.find(m => m.userId === targetUserId || m.username === targetUserId || (targetUsername && m.username === targetUsername));
    if (!targetMem || targetMem.rank === 'DON') {
      res.status(400).json({ error: 'Cannot demote the Don.' });
      return;
    }

    const ladder: MafiaRank[] = ['STREET_THUG', 'SOLDIER', 'CAPO', 'CONSIGLIERE', 'UNDERBOSS'];
    const curIdx = ladder.indexOf(targetMem.rank);
    if (curIdx <= 0) {
      res.status(400).json({ error: 'Member is already at lowest rank (Street Thug).' });
      return;
    }

    const prevRank = ladder[curIdx - 1];
    targetMem.rank = prevRank;
    const targetUsr = Object.values(db.users).find((u: UserAccount) => u.id === targetMem.userId || u.username === targetMem.username);
    if (targetUsr) targetUsr.familyRank = prevRank;
    saveDb();

    broadcast({ type: 'family:updated', families: db.families, leaderboard: getLeaderboard() });
    res.json({ ok: true, family: fam, families: db.families });
  });

  // Kick Member: Higher rank kicks lower rank
  app.post('/api/family/kick', (req, res) => {
    const { token, targetUserId, targetUsername } = req.body || {};
    const caller = token ? Object.values(db.users).find((u: UserAccount) => u.token === token) : null;
    if (!caller || !caller.familyId) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }
    const fam = db.families.find((f: MafiaFamily) => f.id === caller.familyId);
    if (!fam || !Array.isArray(fam.memberList)) {
      res.status(404).json({ error: 'Family not found.' });
      return;
    }

    const rankLevels: Record<string, number> = {
      DON: 5,
      UNDERBOSS: 4,
      CONSIGLIERE: 3,
      CAPO: 2,
      SOLDIER: 1,
      STREET_THUG: 0
    };

    const callerMem = fam.memberList.find(m => m.userId === caller.id || m.username === caller.username);
    const callerRank = callerMem ? callerMem.rank : (caller.familyRank || 'STREET_THUG');
    const targetMem = fam.memberList.find(m => m.userId === targetUserId || m.username === targetUserId || (targetUsername && m.username === targetUsername));
    if (!targetMem) {
      res.status(404).json({ error: 'Target member not found.' });
      return;
    }

    if ((rankLevels[callerRank] || 0) <= (rankLevels[targetMem.rank] || 0)) {
      res.status(403).json({ error: 'You do not have rank authority to kick this member.' });
      return;
    }

    fam.memberList = fam.memberList.filter(m => m.userId !== targetUserId);
    fam.members = fam.memberList.length;

    const targetUsr = Object.values(db.users).find((u: UserAccount) => u.id === targetUserId);
    if (targetUsr) {
      targetUsr.familyId = '';
      targetUsr.familyTag = 'SOLO';
      targetUsr.familyRank = '';
    }
    saveDb();

    const sysMsg: ChatMessage = {
      id: 'msg_' + Date.now(),
      sender: 'COMMISSION_WIRE',
      familyTag: fam.tag,
      channel: 'system',
      text: `🚫 ${targetMem.username} was excommunicated from [${fam.tag}] by ${caller.username}!`,
      timestamp: Date.now()
    };
    db.chatHistory.push(sysMsg);
    if (db.chatHistory.length > 60) db.chatHistory.shift();

    broadcast({ type: 'family:updated', families: db.families, message: sysMsg, leaderboard: getLeaderboard() });
    res.json({ ok: true, family: fam, families: db.families });
  });

  // Leave Family: Member renounces oath, auto-promotes successor if Don leaves
  app.post('/api/family/leave', (req, res) => {
    const { token } = req.body || {};
    const usr = token ? Object.values(db.users).find((u: UserAccount) => u.token === token) : null;
    if (!usr || !usr.familyId) {
      res.status(400).json({ error: 'Not currently sworn into any Family.' });
      return;
    }
    const fam = db.families.find((f: MafiaFamily) => f.id === usr.familyId);
    if (fam && Array.isArray(fam.memberList)) {
      const wasDon = usr.familyRank === 'DON' || fam.founderName === usr.username || fam.founderId === usr.id;
      fam.memberList = fam.memberList.filter(m => m.userId !== usr.id && m.username !== usr.username);
      fam.members = fam.memberList.length;

      if (wasDon && fam.memberList.length > 0) {
        const rankLevels: Record<string, number> = {
          UNDERBOSS: 4,
          CONSIGLIERE: 3,
          CAPO: 2,
          SOLDIER: 1,
          STREET_THUG: 0
        };
        fam.memberList.sort((a, b) => (rankLevels[b.rank] || 0) - (rankLevels[a.rank] || 0));
        fam.memberList[0].rank = 'DON';
        fam.founderName = fam.memberList[0].username;
        fam.founderId = fam.memberList[0].userId;
        const newDonUsr = Object.values(db.users).find((u: UserAccount) => u.id === fam.memberList[0].userId);
        if (newDonUsr) newDonUsr.familyRank = 'DON';
      } else if (fam.members === 0) {
        db.families = db.families.filter(f => f.id !== fam.id);
      }
    }

    usr.familyId = '';
    usr.familyTag = 'SOLO';
    usr.familyRank = '';
    saveDb();

    broadcast({ type: 'family:updated', families: db.families, leaderboard: getLeaderboard() });
    res.json({ ok: true, families: db.families });
  });

  app.post('/api/family/upgrade', (req, res) => {
    const { familyId, upgradeKey } = req.body || {};
    const fam = db.families.find((f: MafiaFamily) => f.id === familyId);
    if (!fam || !upgradeKey || !(upgradeKey in fam.upgrades)) {
      res.status(400).json({ error: 'Join or found a Family first before funding Family Perks.' });
      return;
    }
    const curLv = fam.upgrades[upgradeKey] || 0;
    if (curLv >= 10) {
      res.status(400).json({ error: 'Upgrade already at maximum Commission cap (Lv.10)' });
      return;
    }
    fam.upgrades[upgradeKey] = curLv + 1;
    fam.respect += 160;
    saveDb();

    broadcast({ type: 'family:updated', families: db.families });
    res.json({ family: fam, families: db.families });
  });

  app.post('/api/family/war-assault', (req, res) => {
    const { familyId, districtId, playerName, powerScore } = req.body || {};
    const fam = db.families.find((f: MafiaFamily) => f.id === familyId);
    const turf = db.turfWars.find((t: TurfDistrict) => t.id === districtId);
    if (!fam || !turf) {
      res.status(400).json({ error: 'Join or create a Family first to assault Turf Districts.' });
      return;
    }

    const pushAmount = Math.max(6, Math.min(18, Math.round((Number(powerScore) || 600) / 140)));
    let captured = false;

    if (!turf.controllingFamilyId) {
      turf.controllingFamilyId = fam.id;
      turf.controlPct = Math.min(100, 35 + pushAmount);
      captured = true;
    } else if (turf.controllingFamilyId === fam.id) {
      turf.controlPct = Math.min(100, turf.controlPct + pushAmount);
    } else {
      turf.controlPct -= pushAmount;
      if (turf.controlPct <= 0) {
        turf.controllingFamilyId = fam.id;
        turf.controlPct = Math.min(100, 35 + Math.abs(turf.controlPct));
        captured = true;
      }
    }

    fam.respect += pushAmount * 25 + (captured ? 300 : 0);
    recalculateTurfCounts();
    saveDb();

    if (captured) {
      const capMsg: ChatMessage = {
        id: 'msg_' + Date.now(),
        sender: 'COMMISSION_WIRE',
        familyTag: fam.tag,
        channel: 'system',
        text: `⚔ [${fam.tag}] ${playerName || 'Capo'} seized control of ${turf.name} for ${fam.name}!`,
        timestamp: Date.now()
      };
      db.chatHistory.push(capMsg);
      if (db.chatHistory.length > 60) db.chatHistory.shift();
      broadcast({ type: 'chat:message', message: capMsg });
    }

    broadcast({ type: 'war:updated', turfWars: db.turfWars, families: db.families });
    res.json({
      turfWars: db.turfWars,
      families: db.families,
      captured,
      points: pushAmount,
      rewardGold: 140 + pushAmount * 15,
      rewardHonor: 18
    });
  });

  app.post('/api/family/boss-attack', (req, res) => {
    const { familyId, playerName, damage } = req.body || {};
    const fam = db.families.find((f: MafiaFamily) => f.id === familyId);
    const rawDmg = Math.max(50, Math.min(25000, Math.round(Number(damage) || 500)));

    const tag = fam ? fam.tag : 'SOLO';
    const key = `[${tag}] ${playerName || 'Hitman'}`;
    db.raidBoss.topContributors[key] = (db.raidBoss.topContributors[key] || 0) + rawDmg;
    db.raidBoss.hp = Math.max(0, db.raidBoss.hp - rawDmg);

    let defeated = false;
    if (fam) {
      fam.respect += Math.round(rawDmg / 25);
    }

    if (db.raidBoss.hp <= 0) {
      defeated = true;
      const nextTier = (db.raidBoss.tier % RAID_BOSS_ROTATION.length) + 1;
      const template = RAID_BOSS_ROTATION[nextTier - 1];
      const killMsg: ChatMessage = {
        id: 'msg_' + Date.now(),
        sender: 'COMMISSION_WIRE',
        familyTag: tag,
        channel: 'system',
        text: `💥 ${key} delivered the finishing blow to ${db.raidBoss.name}!`,
        timestamp: Date.now()
      };
      db.chatHistory.push(killMsg);
      if (db.chatHistory.length > 60) db.chatHistory.shift();
      broadcast({ type: 'chat:message', message: killMsg });

      db.raidBoss = {
        id: 'raid_boss_' + Date.now(),
        name: template.name,
        title: template.title,
        hp: template.baseHp,
        maxHp: template.baseHp,
        tier: nextTier,
        rewardGold: 600 + nextTier * 150,
        rewardGems: 45 + nextTier * 10,
        topContributors: {}
      };
    }

    saveDb();
    broadcast({ type: 'boss:updated', raidBoss: db.raidBoss, families: db.families });
    res.json({
      raidBoss: db.raidBoss,
      families: db.families,
      defeated,
      damageDealt: rawDmg,
      rewardGold: defeated ? 650 : Math.round(rawDmg * 0.08),
      rewardGems: defeated ? 45 : 5,
      rewardHonor: defeated ? 40 : 12
    });
  });

  app.post('/api/meta-balance/report-run', (req, res) => {
    const { weaponId, skills, stageReached, victory } = req.body || {};
    const wId = String(weaponId || 'bow');
    if (!db.metaBalance.weaponStats[wId]) {
      db.metaBalance.weaponStats[wId] = { picks: 0, wins: 0, totalStages: 0 };
    }
    db.metaBalance.weaponStats[wId].picks += 1;
    db.metaBalance.weaponStats[wId].totalStages += Math.max(1, Math.min(25, Number(stageReached) || 1));
    if (victory || Number(stageReached) >= 15) {
      db.metaBalance.weaponStats[wId].wins += 1;
    }

    if (skills && typeof skills === 'object') {
      for (const skId of Object.keys(skills)) {
        db.metaBalance.skillPickCounts[skId] = (db.metaBalance.skillPickCounts[skId] || 0) + 1;
      }
    }

    recomputeMetaBalanceMultipliers();
    saveDb();
    broadcast({ type: 'meta:updated', metaBalance: db.metaBalance });

    res.json({ metaBalance: db.metaBalance });
  });

  wss.on('connection', (ws: WebSocket) => {
    clients.set(ws, {
      ws,
      playerName: 'Hitman',
      familyId: '',
      familyTag: 'SOLO',
      power: 165
    });

    ws.send(
      JSON.stringify({
        type: 'init',
        payload: getBootstrapPayload()
      })
    );

    broadcast({ type: 'presence', onlineCount: getOnlineSyndicateCount() });

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        const client = clients.get(ws);
        if (!client) return;

        if (msg.type === 'identify') {
          client.playerName = String(msg.playerName || client.playerName).slice(0, 18);
          client.familyId = String(msg.familyId || '');
          client.familyTag = String(msg.familyTag || 'SOLO').slice(0, 4);
          client.power = Number(msg.power) || 165;
          broadcast({ type: 'presence', onlineCount: getOnlineSyndicateCount() });
        } else if (msg.type === 'chat:send') {
          const text = String(msg.text || '').trim().slice(0, 160);
          if (!text) return;
          const sender = String(msg.sender || client.playerName || 'Hitman').trim().slice(0, 18);
          const famTag = String(msg.familyTag || client.familyTag || 'SOLO').trim().slice(0, 4);
          const channel = msg.channel === 'family' ? 'family' : 'global';

          const chatEntry: ChatMessage = {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            sender,
            familyTag: famTag,
            channel,
            text,
            timestamp: Date.now()
          };
          db.chatHistory.push(chatEntry);
          if (db.chatHistory.length > 60) db.chatHistory.shift();
          saveDb();

          broadcast({ type: 'chat:message', message: chatEntry });
        } else if (msg.type === 'boss:hit') {
          const dmg = Math.max(25, Math.min(8000, Math.round(Number(msg.damage) || 250)));
          const key = `[${client.familyTag || 'SOLO'}] ${client.playerName}`;
          db.raidBoss.topContributors[key] = (db.raidBoss.topContributors[key] || 0) + dmg;
          db.raidBoss.hp = Math.max(0, db.raidBoss.hp - dmg);
          if (db.raidBoss.hp <= 0) {
            const nextTier = (db.raidBoss.tier % RAID_BOSS_ROTATION.length) + 1;
            const template = RAID_BOSS_ROTATION[nextTier - 1];
            db.raidBoss = {
              id: 'raid_boss_' + Date.now(),
              name: template.name,
              title: template.title,
              hp: template.baseHp,
              maxHp: template.baseHp,
              tier: nextTier,
              rewardGold: 600 + nextTier * 150,
              rewardGems: 45 + nextTier * 10,
              topContributors: {}
            };
          }
          broadcast({ type: 'boss:updated', raidBoss: db.raidBoss, families: db.families });
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      broadcast({ type: 'presence', onlineCount: getOnlineSyndicateCount() });
    });
  });

  app.use((req, res, next) => {
    if (req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'))) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Overdraw.IO Online Syndicate Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
