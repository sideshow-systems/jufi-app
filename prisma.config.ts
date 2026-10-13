import { defineConfig, env } from 'prisma/config';

// Prisma 7 laedt .env nicht mehr von selbst ("explicit environment loading").
// process.loadEnvFile ist Node-Standardbibliothek ab v20.12 und wirft nicht,
// wenn keine .env existiert (z.B. auf dem Server, wo env_file greift).
try {
	process.loadEnvFile();
} catch {
	// kein .env vorhanden — Variablen kommen aus der Umgebung
}

export default defineConfig({
	schema: 'prisma/schema.prisma',
	migrations: {
		path: 'prisma/migrations',
	},
	datasource: {
		url: env('DATABASE_URL'),
	},
});
