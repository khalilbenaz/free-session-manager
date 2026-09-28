# Free Session Manager

Gestionnaire de sessions et application de bureau dédiée **exclusivement** aux modèles d'IA **gratuits** de **Kilo**, **OpenCode** et **OpenRouter**.

Basé sur l'expérience complète de Sessions Manager (multi-terminaux xterm, split layouts, gestion des worktrees git, bascule intelligente de contexte, etc.), **Free Session Manager** offre 100% de gratuité avec 0 coût d'API.

---

## ⚡ Fournisseurs & Modèles Inclus (48 modèles gratuits)

### 1. ⚡ Kilo Free (18 modèles)
- `kilo/nvidia/nemotron-3-super-120b-a12b:free` (Par défaut)
- `kilo/nvidia/nemotron-3-ultra-550b-a55b:free`
- `kilo/nvidia/nemotron-3.5-lightning:free`
- `kilo/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`
- `kilo/kilo-auto/free`
- `kilo/openrouter/free`
- `kilo/liquid/lfm-2.5-2.6b:free`
- `kilo/qwen/qwen3.8-27b:free`
- `kilo/google/gemma-4-31b-it:free`
- `kilo/google/gemma-4-26b-a4b-it:free`
- `kilo/cohere/north-mini-code:free`
- `kilo/stepfun/step-3.7-flash:free`
- `kilo/dots-studio/dots-3-note-preview:free`
- `kilo/poolside/laguna-s-2.1:free`
- `kilo/poolside/laguna-xs-2.1:free`
- `kilo/inclusionai/ling-3.0-flash-fin:free`
- `kilo/inclusionai/ling-3.0-flash-sante:free`
- `kilo/thinkingmachines/inkling-small:free`

### 2. 💻 OpenCode Free (8 modèles)
- `opencode/nemotron-3-ultra-free` (Par défaut)
- `opencode/nemotron-3.5-lightning-free`
- `opencode/ling-3.0-flash-fin-free`
- `opencode/longcat-2.5-preview-free`
- `opencode/mimo-v2.6-flash-free`
- `opencode/muse-spark-1.3-contributor-free`
- `opencode/space-bunny-free`
- `opencode/big-pickle`

### 3. 🌐 OpenRouter Free (22 modèles)
- `openrouter/openrouter/free` (Par défaut - Auto)
- `openrouter/meta-llama/llama-3.3-70b-instruct:free`
- `openrouter/google/gemini-2.0-flash-exp:free`
- `openrouter/deepseek/deepseek-r1:free`
- `openrouter/qwen/qwen-2.5-coder-32b-instruct:free`
- `openrouter/mistralai/mistral-small-24b-instruct-2501:free`
- `openrouter/nvidia/nemotron-3-super-120b-a12b:free`
- `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`
- `openrouter/nvidia/nemotron-3.5-lightning:free`
- `openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`
- `openrouter/liquid/lfm-2.5-2.6b:free`
- `openrouter/qwen/qwen3.8-27b:free`
- `openrouter/google/gemma-4-31b-it:free`
- `openrouter/google/gemma-4-26b-a4b-it:free`
- `openrouter/cohere/north-mini-code:free`
- `openrouter/stepfun/step-3.7-flash:free`
- `openrouter/dots-studio/dots-3-note-preview:free`
- `openrouter/poolside/laguna-s-2.1:free`
- `openrouter/poolside/laguna-xs-2.1:free`
- `openrouter/inclusionai/ling-3.0-flash-fin:free`
- `openrouter/inclusionai/ling-3.0-flash-sante:free`
- `openrouter/thinkingmachines/inkling-small:free`

---

## 🔌 Exécution native (aucune CLI requise)

Depuis la v1.1.0, les trois fournisseurs tournent via un **runner natif** (`bin/direct-agent.js`) qui appelle directement les API — plus besoin d'installer `kilo` ou `opencode` en CLI.

| Fournisseur | Accès | Clé |
|---|---|---|
| **Kilo** | Kilo Gateway (`api.kilo.ai`), anonyme pour les modèles gratuits | `KILO_API_KEY` optionnelle |
| **OpenCode** | `OPENCODE_API_KEY` → Zen direct ; sinon moteur officiel `opencode serve` (headless, lancé et arrêté automatiquement) si le binaire est présent ; sinon repli sur Kilo | `OPENCODE_API_KEY` optionnelle |
| **OpenRouter** | API OpenRouter | `OPENROUTER_API_KEY` requise |

Les clés se définissent dans les variables d'environnement ou dans le fichier `.env` du projet.

CLI : `fsm` (ouvre l'app, démarre le serveur si besoin), `fsm stop | restart | status | log`.

---

## 🚀 Installation & Lancement

```bash
# Compiler l'application macOS (.app) et l'installer dans /Applications/
npm run install:app

# Ou lancer directement en mode développement
npm start
```