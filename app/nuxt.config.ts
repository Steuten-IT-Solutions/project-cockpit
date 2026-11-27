// Nuxt configuration of the new cockpit. See README.md in this folder for the layout.
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  modules: ['@nuxt/ui', '@nuxt/eslint', 'nuxt-security'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  telemetry: false,

  app: {
    head: {
      htmlAttrs: { lang: 'de' },
      title: 'Cockpit',
      meta: [{ name: 'robots', content: 'noindex, nofollow' }, { name: 'color-scheme', content: 'light dark' }],
      // Installable on the phone's home screen (needed for push on iPhones).
      link: [{ rel: 'manifest', href: '/manifest.webmanifest' }],
    },
  },

  // Server-only settings. In production every value comes from an environment
  // variable with the NUXT_ prefix (e.g. NUXT_APP_KEY, NUXT_DATABASE_URL); nothing
  // secret is ever committed. See .env.example.
  runtimeConfig: {
    appKey: '',
    databaseUrl: '',
    session: {
      idleTimeout: 2 * 60 * 60,
      absoluteTimeout: 12 * 60 * 60,
    },
    // true behind HTTPS: cookies get the __Host- prefix and the Secure flag.
    secureCookies: true,
    // The sections of the PHP cockpit's config.php. Validated by server/lib/config.ts;
    // a section is off while its first value is empty.
    baseUrl: '',
    timezone: 'Europe/Berlin',
    setupToken: '',
    github: { clientId: '', privateKeyFile: '', accounts: '', apiBase: '' },
    vercel: { token: '', teamId: '', apiBase: '', billing: '' },
    statusReports: { org: '' },
    alerts: { email: '', from: '' },
    push: { privateKeyFile: '', subject: '' },
    bugReports: { repo: '', labelPrefix: '', clientId: '', privateKeyFile: '' },
    releases: { repo: '', webhookSecret: '' },
    mail: { sendmail: '' },
    // The ERP's e-invoice engine: PHP binary and the folder with bin/invoice.php and vendor/.
    // Empty: 'php' from PATH and the folder above the app (on the server <app>/node/..).
    erp: { phpBinary: '', phpDir: '' },
    // Folder with the SQL migrations, shared with the PHP cockpit. Empty: ../migrations.
    migrationsDir: '',
    // false: the 15-minute background jobs do nothing (tests, the rehearsal on a copy of
    // the database, which must not send alert e-mails). The refresh button still works.
    scheduledJobs: true,
    // Host name of the status subdomain (e.g. status.steuten-it-solutions.de). When set, the
    // receiver (server/routes/_receiver) answers only requests for that host.
    receiverHost: '',
  },

  // Close to the PHP cockpit's policy (src/Security/Headers.php), with two
  // deliberate differences:
  // - Scripts: Nuxt needs small inline bootstrap scripts. They are allowed by a
  //   per-response nonce ('strict-dynamic'), never by 'unsafe-inline'.
  // - Styles: the UI components set style attributes and add style elements at
  //   runtime, which a nonce cannot cover. Styles therefore allow 'unsafe-inline'.
  //   Injected CSS cannot run code; scripts stay strict.
  security: {
    nonce: true,
    ssg: false,
    sri: true,
    headers: {
      contentSecurityPolicy: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'nonce-{{nonce}}'", "'strict-dynamic'"],
        'script-src-attr': ["'none'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'base-uri': ["'none'"],
        'object-src': ["'none'"],
        'upgrade-insecure-requests': false,
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: 'same-origin',
      referrerPolicy: 'no-referrer',
      strictTransportSecurity: { maxAge: 31536000, includeSubdomains: false },
      xContentTypeOptions: 'nosniff',
      xFrameOptions: 'DENY',
      permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [] },
    },
    // The cockpit has its own CSRF token check (server/middleware/session.ts).
    csrf: false,
    // Off: it rejects any request body containing "<" or similar (a note like "Preis < 10 €"
    // got 400), and it reads the body before the receiver can check its signature. Output is
    // escaped by Vue everywhere (no v-html) and the CSP forbids inline scripts.
    xssValidator: false,
    rateLimiter: false,
    // Same-origin only: no Access-Control-Allow-Origin header at all.
    corsHandler: false,
    requestSizeLimiter: { maxRequestSizeInBytes: 1_000_000, maxUploadFileRequestInBytes: 8_000_000 },
  },

  routeRules: {
    '/**': { headers: { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' } },
    // "Katalog" is called "Artikel" since #49; old bookmarks still work.
    '/erp/catalog': { redirect: '/erp/articles' },
    // Bug reports carry a screenshot of up to 2 MB as base64 (the receiver checks its own limits).
    '/_receiver/**': { security: { requestSizeLimiter: { maxRequestSizeInBytes: 3_100_000, maxUploadFileRequestInBytes: 3_100_000 } } },
  },

  build: {
    // vue-router 5 reads the compile-time flag __VUE_OPTIONS_API__. Externalised in the
    // server bundle, nothing replaces it and every page render fails; bundled, Nitro does.
    transpile: ['vue-router'],
  },

  nitro: {
    // Listen on localhost only; Apache terminates TLS and forwards (see README).
    preset: 'node-server',
    // The background jobs (server/tasks/cockpit/jobs.ts) run inside the Node process every
    // 15 minutes, like the PHP cron job did. The database lock keeps runs from overlapping.
    experimental: { tasks: true },
    scheduledTasks: { '*/15 * * * *': ['cockpit:jobs'] },
  },

  ui: {
    // No web fonts from third parties; the system font stack is enough.
    fonts: false,
  },

  eslint: {
    config: { stylistic: false },
  },
})
