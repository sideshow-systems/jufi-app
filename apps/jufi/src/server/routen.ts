import type { Router } from 'express';

interface RouteSchicht {
	route?: { path?: unknown; methods?: Record<string, boolean> };
}

/**
 * Methode und Pfad jeder Route eines Routers, fuer Mandanten- und Schutz-Test.
 *
 * Liest Express' interne Schichtenliste (stack). Eine Schicht ohne route
 * (router.use, Unter-Router) oder mit einem Pfad, der kein Text ist, wirft: Der
 * Test koennte sie nicht benennen, und still ueberspringen hiesse, eine
 * ungepruefte Route durchzulassen.
 */
export function routenAus(router: Router, name: string): { methode: string; pfad: string }[] {
	const routen: { methode: string; pfad: string }[] = [];
	for (const schicht of router.stack as RouteSchicht[]) {
		const route = schicht.route;
		if (!route || typeof route.path !== 'string') {
			throw new Error(`${name} darf nur Routen mit Textpfad enthalten, keine Unter-Router oder Middleware`);
		}
		const methoden = Object.entries(route.methods ?? {})
			.filter(([, aktiv]) => aktiv)
			.map(([methode]) => (methode === '_all' ? 'ALL' : methode.toUpperCase()));
		for (const methode of methoden) routen.push({ methode, pfad: route.path });
	}
	return routen;
}
