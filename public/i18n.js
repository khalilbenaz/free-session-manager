'use strict';
// Interface bilingue FR / EN (#15). La clé est le texte français : t('Nouvelle session') → « New session » en anglais.
const EN = {
  // états
  'démarrage': 'starting', 'travaille': 'working', 'attend une réponse': 'waiting for you', 'prêt': 'ready', 'arrêtée': 'stopped', 'terminé': 'done', 'interrompu': 'interrupted',
  'attend toujours une réponse': 'is still waiting for you', 'travaille depuis longtemps': 'has been working for a long time',
  // barre latérale / barre
  'Sessions': 'Sessions', 'Nouvelle': 'New', '+ Nouvelle': '+ New', 'Rechercher…': 'Search…', 'Dans un terminal': 'In a terminal', 'Tout ramener': 'Bring all',
  'Historique': 'History', 'Épinglées': 'Pinned', 'Sans groupe': 'No group', 'Relancer': 'Restart', 'Reprendre': 'Resume', 'Arrêter': 'Stop', 'Fermer': 'Close',
  'Worktree': 'Worktree', 'base': 'base', 'branche': 'branch', 'Modifications': 'Changes', 'Chronologie': 'Timeline', 'Consommation': 'Usage',
  '↗ Ouvrir': '↗ Open', 'Aucune modification': 'No changes', 'modification': 'change', 'modifications': 'changes',
  '(vide — glisser une session ici)': '(empty — drop a session here)', 'Vider ce panneau': 'Clear this pane',
  'Aucune session': 'No sessions', '+ Nouvelle session': '+ New session', 'Redémarrer le serveur': 'Restart server',
  'nouvelle session': 'new session', 'palette': 'palette', 'historique': 'history', 'naviguer': 'navigate',
  // menus
  'Renommer': 'Rename', 'Ouvrir dans…': 'Open in…', 'Dans l’éditeur': 'In editor', 'Dans le Finder': 'In Finder', 'Dans l’Explorateur': 'In Explorer',
  'File d’attente…': 'Queue…', 'Insérer un prompt…': 'Insert a prompt…', 'Envoyer à plusieurs sessions…': 'Send to several sessions…',
  'Exporter la conversation…': 'Export conversation…', 'Groupe…': 'Group…', 'Désépingler': 'Unpin', 'Épingler en haut': 'Pin to top',
  'Réactiver les alertes': 'Unmute alerts', 'Couper les alertes de cette session': 'Mute alerts for this session',
  'Copier le chemin': 'Copy path', 'Copier l’identifiant de session': 'Copy session ID', 'Copier': 'Copy', 'Coller': 'Paste', 'Couper': 'Cut',
  'Joindre un fichier…': 'Attach a file…', 'Tout sélectionner': 'Select all', 'Effacer l’écran': 'Clear screen',
  'Zoom avant': 'Zoom in', 'Zoom arrière': 'Zoom out', 'Taille normale': 'Actual size', 'Recharger la fenêtre': 'Reload window',
  'Nouvelle session': 'New session', 'Afficher': 'Show', 'Ramener dans asm…': 'Bring into asm…', 'ramener': 'bring',
  // fermeture / worktree
  'Cette session travaille dans le worktree': 'This session works in the worktree', 'Fusionné dans': 'Merged into',
  'Supprimer définitivement le worktree et la branche': 'Permanently delete the worktree and branch',
  "Le processus sera arrêté (la conversation reste reprenable depuis l'historique).": 'The process will be stopped (the conversation can still be resumed from History).',
  'Fermer la session': 'Close session', 'Fermer et garder le worktree': 'Close and keep the worktree',
  'Le dossier et la branche restent : vous pourrez y revenir, fusionner plus tard ou les supprimer.': 'The folder and branch stay: you can come back, merge later or delete them manually.',
  'Fusionner puis supprimer': 'Merge then delete', 'Fusionne la branche dans sa branche de base, puis supprime le worktree et la branche. Les modifications doivent être commitées.': 'Merges the branch into its base branch, then deletes the worktree and branch. Changes must be committed.',
  'Supprimer le worktree et la branche': 'Delete the worktree and branch', 'Abandonne tout le travail de cette branche.': 'Discards all work on this branch.',
  // nouvelle session
  'Modèle de session': 'Session template', '— aucun —': '— none —', 'Dossier de travail': 'Working folder', 'Parcourir…': 'Browse…', 'Nom': 'Name', 'Groupe': 'Group',
  '(nom du dossier)': '(folder name)', '(aucun)': '(none)', 'Modèle': 'Model', 'Mode': 'Mode', 'par défaut': 'default',
  'Travailler dans un': 'Work in a dedicated', 'worktree git': 'git worktree', 'dédié (nouvelle branche, sans toucher au dépôt principal)': '(new branch, main checkout untouched)',
  'Branche': 'Branch', 'Options avancées': 'Advanced options', 'Premier prompt (envoyé dès que la session est prête)': 'First prompt (sent as soon as the session is ready)',
  'Enregistrer comme modèle': 'Save as template', 'Annuler': 'Cancel', 'Lancer': 'Launch', 'Valider': 'OK',
  'Dossier': 'Folder', 'Nom du modèle': 'Template name', 'Retrouvable dans « Modèle de session » et la palette (Ctrl+K).': 'Available in “Session template” and the palette (Ctrl+K).',
  'Modèle enregistré': 'Template saved', 'Création impossible': 'Could not create', 'Renommer la session': 'Rename session', 'Renommer la conversation': 'Rename conversation',
  'Le nom est aussi mémorisé pour cette session.': 'The name is also saved for this session.',
  'Renommage impossible : ': 'Rename failed: ',
  // panneau modifications
  'Chargement…': 'Loading…', 'Le dossier de cette session n’est pas un dépôt git.': 'This session’s folder is not a git repository.', 'Actualiser': 'Refresh',
  'Worktree dédié': 'Dedicated worktree', 'Fusionner dans': 'Merge into', 'indexé': 'staged', 'Annuler les modifications de ce fichier': 'Discard changes to this file',
  'Message du commit': 'Commit message', 'Proposer un message': 'Suggest a message', 'Committer tout': 'Commit all', 'Cliquer un fichier pour voir le diff.': 'Click a file to see its diff.',
  'Aucune modification dans ce dossier.': 'No changes in this folder.', '(fichier binaire ou vide)': '(binary or empty file)', 'Annuler toutes les modifications de': 'Discard all changes to',
  'Le fichier (non suivi) sera supprimé.': 'The (untracked) file will be deleted.', 'Modifie': 'Update', 'ajoute': 'add', 'supprime': 'remove', 'Mise à jour': 'Update',
  'Session': 'Session', 'Commit créé': 'Commit created', 'Fusionner la branche': 'Merge branch', 'dans': 'into',
  // chronologie / consommation
  'Chronologie des actions': 'Action timeline', 'Aucune action enregistrée pour l’instant.': 'No actions recorded yet.',
  'Consommation estimée': 'Estimated usage', 'dernières 5h': 'last 5h', 'aujourd’hui': 'today', '7 derniers jours': 'last 7 days',
  'Entrée': 'input', 'Sortie': 'output', 'lecture cache': 'cache read', 'écriture cache': 'cache write', 'Coût estimé': 'estimated cost',
  'Consommation par modèle': 'Usage by model', 'Volume journalier (7j)': 'Daily volume (7d)', 'Conversations les plus actives (7j)': 'Most active conversations (7d)',
  'Enregistrer en Markdown (.md)': 'Save as Markdown (.md)', 'Copier le Markdown': 'Copy Markdown', 'Copié': 'Copied', 'Imprimer / PDF…': 'Print / PDF…',
  'Groupe de la session': 'Session group', 'Groupes existants': 'Existing groups', '« - » pour retirer la session de son groupe.': '“-” removes the session from its group.',
  // réglages
  'Réglages': 'Settings', 'Système (suit Windows / macOS)': 'System (follows Windows / macOS)', 'Général': 'General', 'Terminal': 'Terminal', 'Notifications': 'Notifications', 'Modèles de session': 'Session templates', 'Prompts': 'Prompts',
  'Diagnostic': 'Diagnostics', 'Journaux': 'Logs', 'À propos': 'About', 'Thème': 'Theme', 'Sombre': 'Dark', 'Clair': 'Light', 'Système': 'System', 'Langue': 'Language',
  'Automatique': 'Automatic', 'Modèle par défaut': 'Default model', 'Mode par défaut': 'Default mode', 'Proposer un worktree git par défaut dans un dépôt': 'Offer a git worktree by default in a repository',
  'Éditeur pour « Ouvrir dans »': 'Editor for “Open in”', 'Commande personnalisée': 'Custom command', 'Commande personnalisée…': 'Custom command…',
  'Mises à jour automatiques': 'Automatic updates',
  'Réduire dans la zone de notification (au lieu de la barre des tâches)': 'Minimize to the notification area (instead of the taskbar)',
  "Fermer la fenêtre la garde dans la zone de notification (les sessions continuent)": 'Closing the window keeps the app in the notification area (sessions keep running)', 'Barre latérale compacte': 'Compact sidebar', 'Taille du texte': 'Font size', 'Police': 'Font',
  'Raccourcis :': 'Shortcuts:', 'pour zoomer.': 'to zoom.', 'Notifications système': 'System notifications', 'Son': 'Sound', 'Aucun': 'None', 'Discret': 'Soft', 'Clochette': 'Bell',
  '▶ Tester': '▶ Test', 'Ne pas déranger (ni notification ni son)': 'Do not disturb (no notification, no sound)',
  'Rappel si une session attend depuis (minutes, 0 = jamais)': 'Remind me when a session has been waiting for (minutes, 0 = never)',
  'Alerte si une session travaille depuis plus de (minutes, 0 = jamais)': 'Alert when a session has been working for more than (minutes, 0 = never)',
  'Un modèle mémorise dossier, nom, modèle, mode, worktree, groupe et premier prompt. Créer : « Enregistrer comme modèle » dans la fenêtre Nouvelle session.': 'A template stores folder, name, model, mode, worktree, group and first prompt. Create one with “Save as template” in the New session window.',
  'Snippets réutilisables, insérés dans la session active depuis la palette (': 'Reusable snippets, inserted into the active session from the palette (', ') ou le menu ⋯.': ') or the ⋯ menu.',
  'Ouvrir la bibliothèque de prompts': 'Open the prompt library', 'Copier le rapport': 'Copy report', 'Filtrer les journaux…': 'Filter logs…',
  '— logiciel libre (MIT).': '— free software (MIT).', 'Rechercher des mises à jour': 'Check for updates',
  'Aucun modèle pour l’instant.': 'No templates yet.', 'Supprimer': 'Delete', 'Renommer le modèle': 'Rename template', 'Supprimer le modèle': 'Delete template',
  'serveur': 'server', 'introuvable ou en erreur': 'not found or failing', 'introuvable (worktrees et panneau Modifications indisponibles)': 'not found (worktrees and Changes panel unavailable)',
  'Données': 'Data', 'Code': 'Code', 'actives': 'running', 'mémoire': 'memory', 'en service depuis': 'up for', 'dernières lignes du journal': 'last log lines',
  'Rapport copié — à coller dans une issue GitHub': 'Report copied — paste it into a GitHub issue',
  'Dans le navigateur : mettre à jour avec git pull puis fsm restart.': 'In the browser: update with git pull then fsm restart.',
  'Redémarrer pour mettre à jour': 'Restart to update', 'Télécharger': 'Download', 'Recherche de mises à jour…': 'Checking for updates…',
  'Version de développement : mises à jour automatiques désactivées.': 'Development build: automatic updates disabled.', 'Free Session Manager est à jour.': 'Free Session Manager is up to date.',
  'Mises à jour automatiques désactivées dans les réglages.': 'Automatic updates are disabled in Settings.', 'Téléchargement de la version {v}… {p}': 'Downloading version {v}… {p}',
  'Version {v} prête : redémarre pour l’installer.': 'Version {v} is ready: restart to install it.', 'Version {v} disponible au téléchargement.': 'Version {v} is available for download.',
  'Échec de la vérification : {e}': 'Update check failed: {e}', 'Réglage non enregistré : ': 'Setting not saved: ',
  // remote control
  "📱 Activer la connexion distante Remote Control (--remote-control)": '📱 Enable Remote Control connection (--remote-control)',
  'Remote Control activé pour cette session': 'Remote Control enabled for this session', 'Remote Control désactivé': 'Remote Control disabled',
  'Désactiver Remote Control': 'Turn off Remote Control', '📱 Activer Remote Control': '📱 Enable Remote Control',
  // modèles / prompts
  'Enregistrer comme modèle…': 'Save as template…', 'Enregistrer la session comme modèle': 'Save session as template',
  'Reprend le dossier, le groupe, le modèle et le mode de cette session. Retrouvable dans « Nouvelle session » et la palette (Ctrl+K).': 'Uses this session\u2019s folder, group, model and mode. Available in “New session” and the palette (Ctrl+K).',
  'Un modèle relance en un clic une session type : même dossier, groupe, modèle, mode, worktree et premier prompt.': 'A template relaunches a typical session in one click: same folder, group, model, mode, worktree and first prompt.',
  'Créer depuis la session active': 'Create from active session', 'Nouvelle session…': 'New session…', '— aucun modèle : « Enregistrer comme modèle » en bas —': '— no templates: use “Save as template” below —',
  // verrouillage
  'Session verrouillée. Elle continue de tourner ; son contenu est masqué.': 'Session locked. It keeps running; its content is hidden.',
  'Mot de passe': 'Password', 'Déverrouiller': 'Unlock', 'Indice': 'Hint', 'Mot de passe incorrect': 'Wrong password', 'Session verrouillée': 'Session locked',
  '4 caractères minimum.': 'At least 4 characters.', 'Les deux mots de passe ne correspondent pas.': 'The two passwords do not match.',
  'Changer le mot de passe': 'Change password', 'Verrouiller': 'Lock', 'Retirer le mot de passe': 'Remove password', 'Mot de passe retiré': 'Password removed',
  'Verrouiller par mot de passe…': 'Lock with a password…', 'Verrouiller maintenant': 'Lock now', 'Changer le mot de passe…': 'Change password…', 'Retirer le mot de passe…': 'Remove password…',
  'Mot de passe actuel': 'Current password', 'Confirmer le mot de passe': 'Confirm password', "Indice (facultatif, visible sur l'écran de verrouillage)": 'Hint (optional, shown on the lock screen)',
  // bascule d'agent / modèles
  'Basculer vers ': 'Switch to ', 'Basculer vers': 'Switch to', 'le contexte est transmis': 'context is carried over',
  'Basculer sans changer de modèle': 'Switch without changing model', 'Basculer maintenant': 'Switch now',
  'Bascule impossible': 'Cannot switch', 'Changer de modèle…': 'Change model…',
  'Agent actif': 'Active agent', 'Modèle actif': 'Active model', 'Cliquer pour changer de modèle': 'Click to change model',
  'Ex: kilo/openrouter/free, nemotron-3…': 'e.g. kilo/openrouter/free, nemotron-3…',
  'Redémarrer la session': 'Restart session', 'Redémarrer / reprendre la conversation': 'Restart / resume the conversation',
  // effort / modes (options reconstruites à l'affichage)
  'Moyen (medium)': 'Medium', 'Élevé (high)': 'High', 'Maximum (max)': 'Max', 'Faible (low)': 'Low',
  'Non applicable (inclus)': 'Not applicable (included)', 'Par défaut': 'Default',
  'Approbation auto (skip permissions)': 'Auto-approval (skip permissions)',
  'Accepter les modifications (accept-edits)': 'Accept edits (accept-edits)', 'Planifier avant de coder (plan)': 'Plan before coding (plan)',
  // divers
  'ouverte': 'open', 'Ouverture…': 'Opening…', 'Sélecteur indisponible : ': 'Folder picker unavailable: ',
  'Chargement des quotas…': 'Loading quotas…', 'Aucun quota disponible.': 'No quota available.',
  'Échec de la récupération des quotas :': 'Failed to fetch quotas: ',
  'Analyse du transcript…': 'Analyzing transcript…', 'Copier le briefing': 'Copy briefing',
  'Redémarrer l’application': 'Restart the application', 'Redémarrage…': 'Restarting…',
  'Le serveur ne redémarre pas — voir le journal': 'The server won’t restart — see the logs',
};

let currentLang = 'fr';
function t(s) {
  if (currentLang !== 'en') return s;
  return EN[s] || s;
}

function setLang(lang) {
  if (lang === 'auto' || !lang) {
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    currentLang = /^fr/i.test(nav) ? 'fr' : 'en';
  } else {
    currentLang = lang === 'en' ? 'en' : 'fr';
  }
  document.documentElement.lang = currentLang;
}
