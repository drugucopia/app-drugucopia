#!/usr/bin/env node
/**
 * Drugucopia — Firebase Connectivity Diagnostic
 *
 * Usage:
 *   1. Create a .env file in the project root (or export the env vars below):
 *
 *        NEXT_PUBLIC_FIREBASE_API_KEY=...
 *        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
 *        NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
 *        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
 *        NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
 *        NEXT_PUBLIC_FIREBASE_APP_ID=...
 *
 *   2. Run:  node scripts/diagnose-firebase.js
 *
 * What this script does:
 *   - Reads env vars
 *   - Initializes the Firebase app (same as the app does)
 *   - Initializes Firestore with long-polling auto-detect
 *   - Attempts to read a non-existent doc from secure_rooms (no auth required)
 *   - Times out after 30s (same as the app) and prints a diagnostic summary
 *
 * Exit codes:
 *   0 — Firestore reachable (read succeeded, doc just doesn't exist yet — fine)
 *   1 — Missing env vars
 *   2 — Permission denied (deploy firestore.rules)
 *   3 — Network/timeout (WebSocket blocked, firewall, etc.)
 *   4 — Database not created
 *   5 — Other error
 */

const path = require('path')

// Load .env from the project root if present
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
} catch {
  // dotenv not installed — rely on process.env being set externally
}

const {
  NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID,
} = process.env

const required = {
  NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID,
}

console.log('\n=== Drugucopia Firebase Diagnostic ===\n')

// 1) Check env vars
const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k)
if (missing.length > 0) {
  console.error('❌ Missing Firebase env vars:', missing.join(', '))
  console.error('\nCreate a .env file in the project root with:')
  console.error('  NEXT_PUBLIC_FIREBASE_API_KEY=...')
  console.error('  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...')
  console.error('  NEXT_PUBLIC_FIREBASE_PROJECT_ID=...')
  console.error('  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...')
  console.error('  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...')
  console.error('  NEXT_PUBLIC_FIREBASE_APP_ID=...')
  process.exit(1)
}

console.log('✅ All Firebase env vars present')
console.log('   Project ID:', NEXT_PUBLIC_FIREBASE_PROJECT_ID)
console.log('   Auth Domain:', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN)
console.log('')

// 2) Load Firebase SDK
let firebaseApp, firebaseFirestore
try {
  // Resolve from the project's own node_modules so this script works without
  // a global firebase install.
  const firebasePath = path.join(__dirname, '..', 'node_modules', 'firebase')
  firebaseApp = require(path.join(firebasePath, 'app'))
  firebaseFirestore = require(path.join(firebasePath, 'firestore'))
} catch (e) {
  console.error('❌ Could not load firebase module. Run `bun install` first.')
  console.error('   Error:', e.message)
  process.exit(5)
}

const { initializeApp, getApps } = firebaseApp
const {
  initializeFirestore,
  getFirestore,
  doc,
  getDoc,
} = firebaseFirestore

// 3) Initialize Firebase
// Map env vars to the keys Firebase's initializeApp actually expects.
// (Previous version of this script passed the env var NAMES as keys,
// which Firebase rejected with: "projectId" not provided in firebase.initializeApp.)
const firebaseConfig = {
  apiKey: NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: NEXT_PUBLIC_FIREBASE_APP_ID,
}

let app, db
try {
  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)
  try {
    db = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
    })
  } catch {
    db = getFirestore(app)
  }
  console.log('✅ Firebase SDK initialized')
} catch (e) {
  console.error('❌ Firebase initialization failed:', e.message)
  process.exit(5)
}

// 4) Try to read a (likely non-existent) doc from secure_rooms.
//    This tests: network connectivity, rules, database existence.
const PROBE_DOC_ID = 'diagnostic-probe-00000000'
const docRef = doc(db, 'secure_rooms', PROBE_DOC_ID)

console.log('\n⏳ Attempting to read doc: secure_rooms/' + PROBE_DOC_ID)
console.log('   (this doc likely does not exist — that is OK, we just want')
console.log('    to verify that Firestore responds at all)')
console.log('')

const startedAt = Date.now()
let settled = false

const timeout = setTimeout(() => {
  if (settled) return
  settled = true
  const elapsed = Date.now() - startedAt
  console.error('❌ TIMEOUT after', elapsed, 'ms — Firestore never responded.')
  console.error('')
  console.error('This is the SAME symptom the app reports as "Sync connection timeout".')
  console.error('Most common causes:')
  console.error('  1. Firestore database was never created in Firebase Console.')
  console.error('     Fix: https://console.firebase.google.com → your project →')
  console.error('     Firestore Database → "Create database" (start in production mode).')
  console.error('')
  console.error('  2. The database exists but rules deny all access.')
  console.error('     Fix: deploy firestore.rules from this repo:')
  console.error('       firebase deploy --only firestore:rules')
  console.error('')
  console.error('  3. Network is blocking WebSocket (and long-polling fallback failed).')
  console.error('     Try: a different network (mobile hotspot vs. WiFi, no VPN).')
  console.error('')
  console.error('  4. CSP in your hosting environment blocks *.googleapis.com.')
  console.error('')
  console.error('  5. Wrong projectId — verify the project exists at')
  console.error('     https://console.firebase.google.com/project/' + NEXT_PUBLIC_FIREBASE_PROJECT_ID)
  process.exit(3)
}, 30000)

  ; (async () => {
    try {
      const snap = await getDoc(docRef)
      if (settled) return
      settled = true
      clearTimeout(timeout)
      const elapsed = Date.now() - startedAt
      console.log('✅ Firestore responded in', elapsed, 'ms')
      console.log('   Doc exists:', snap.exists())
      if (snap.exists()) {
        console.log('   ⚠️  The probe doc actually exists — your sync room name might')
        console.log('      have collided with it. Pick a more unique room name.')
      } else {
        console.log('   (Doc does not exist — this is the expected result.)')
      }
      console.log('')
      console.log('✅ Firebase is reachable. If the app still cannot connect,')
      console.log('   check that the app build has the same env vars baked in')
      console.log('   (run `next build` with the env vars set).')
      process.exit(0)
    } catch (err) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      const elapsed = Date.now() - startedAt
      const code = err?.code || ''
      const msg = err?.message || String(err)
      console.error('❌ Firestore read failed after', elapsed, 'ms')
      console.error('   Error code:', code || '(none)')
      console.error('   Message:', msg)
      console.error('')

      if (code.includes('permission-denied') || msg.includes('PERMISSION_DENIED')) {
        console.error('Fix: Deploy firestore.rules from the repo:')
        console.error('  firebase deploy --only firestore:rules')
        console.error('')
        console.error('Or paste the rules into the Firebase Console:')
        console.error('  Firestore Database → Rules → paste firestore.rules → Publish')
        process.exit(2)
      }
      if (code.includes('not-found')) {
        console.error('Fix: Create the Firestore database in Firebase Console:')
        console.error('  https://console.firebase.google.com → your project →')
        console.error('  Firestore Database → "Create database"')
        process.exit(4)
      }
      if (code.includes('unavailable')) {
        console.error('Firestore is temporarily unavailable. Try again in a few minutes.')
        console.error('If this persists, check https://status.firebase.google.com/')
        process.exit(3)
      }
      if (code.includes('unauthenticated')) {
        console.error('This app does not use Firebase Auth, so this error usually means')
        console.error('the projectId is wrong. Verify it at')
        console.error('  https://console.firebase.google.com/project/' + NEXT_PUBLIC_FIREBASE_PROJECT_ID)
        process.exit(5)
      }

      console.error('Unknown error. See full message above.')
      process.exit(5)
    }
  })()
