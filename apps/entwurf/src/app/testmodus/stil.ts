/**
 * Signalfarbe des Testmodus (Spec TP1 5.2, 7): Violett, bewusst kein Token der
 * App und nie die Vereinsfarbe — die Testperson soll sofort sehen, was zum
 * Entwurf gehoert und was zum Test. Lebt nur in diesem Ordner.
 */
export const TM_STIL = `
	:host {
		--tm: #6d28d9;
		--tm-flaeche: #ede9fe;
		--tm-text: #4c1d95;
		--auf-tm: #ffffff;
	}
	@media (prefers-color-scheme: dark) {
		:host-context(:root:not([data-theme='light'])) {
			--tm-flaeche: #2e1065;
			--tm-text: #ddd6fe;
		}
	}
	:host-context(:root[data-theme='dark']) {
		--tm-flaeche: #2e1065;
		--tm-text: #ddd6fe;
	}
	.tm-knopf {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--a2);
		min-height: var(--tippflaeche);
		padding: 0 var(--a4);
		border-radius: var(--radius-pille);
		border: 1px solid var(--tm);
		background: var(--tm);
		color: var(--auf-tm);
		font-weight: 600;
	}
	.tm-knopf.leise {
		background: var(--tm-flaeche);
		border-color: transparent;
		color: var(--tm-text);
	}
	.tm-knopf:focus-visible {
		outline: 2px solid var(--tm);
		outline-offset: 2px;
	}
`;
