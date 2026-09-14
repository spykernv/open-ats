<div align="center">

# open-ats

**Un logiciel de recrutement par IA, reconstruit à la main et ouvert à tous.**
*Faites passer votre candidature par la machine — avant qu'une vraie machine ne le fasse.*

[![Licence MIT](https://img.shields.io/badge/licence-MIT-6c7dff)](LICENSE)
[![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A5%2020-3c873a)](https://nodejs.org)
[![100% local](https://img.shields.io/badge/données-100%25%20locales-46d6c0)](#vos-données-ne-quittent-jamais-votre-machine)
[![Sans clé API](https://img.shields.io/badge/clé%20API-optionnelle-f5a623)](#les-moteurs)

🇬🇧 [Read this in English](README.en.md)

<img src="docs/screenshots/08-pipeline.png" alt="La pipeline de 16 agents qui s'exécute en direct" width="820">

</div>

---

## Pourquoi ce projet existe

Quand vous postulez quelque part, votre CV est d'abord lu par un logiciel. Il est découpé, scoré, classé, filtré — et dans la grande majorité des cas, une personne ne le voit qu'après ce tri. Ce processus est invisible pour vous. Vous n'en recevez que le résultat : un mail de refus poli, ou rien du tout.

Ça m'a longtemps frustré. Pas parce que c'est injuste — un recruteur qui reçoit 800 candidatures a besoin d'un tri — mais parce que **c'est une boîte noire à laquelle on demande aux candidats de se soumettre sans jamais leur en montrer l'intérieur.**

Alors j'ai fait l'inverse. J'ai reconstruit la boîte noire, en clair, à partir de ce qu'on sait publiquement du fonctionnement des ATS et des outils de présélection par IA : le parsing de l'annonce, la matrice de critères, le scoring multi-filtres, la revue en 20 secondes, le benchmark face au vivier. Puis je me suis mis dedans.

**Ce que j'ai découvert m'a surpris.** La plupart de mes candidatures ne tombaient pas sur un manque de compétence — elles tombaient sur un défaut de formulation. Je disais « automatisation du reporting hebdomadaire » là où le poste cherchait « analyse de données ». Même travail, vocabulaire différent, filtre raté. Voir un système me le dire noir sur blanc, critère par critère, preuve par preuve, a changé ma façon de candidater.

Depuis, ce système m'a ouvert des portes que je n'espérais pas, et m'a fait rencontrer des gens remarquables. Je le publie parce que je n'ai aucune raison de le garder pour moi : si vous cherchez un poste en ce moment, il est à vous.

---

## Ce que ça fait

Vous déposez trois choses — **l'annonce** (captures d'écran, PDF ou texte), **votre CV**, et **votre lettre** si vous en avez une. Seize agents se relaient ensuite pour :

1. **Comprendre le poste** — reconstruire l'annonce, en extraire une matrice de critères (`MUST_HAVE`, `STRONG_SIGNAL`, `NICE_TO_HAVE`, contexte, culture), en distinguant ce qui est écrit noir sur blanc de ce qui est simplement inféré.
2. **Comprendre l'entreprise** — recherche web, avec chaque constat étiqueté `FACT`, `STRONG_INFERENCE` ou `WEAK_INFERENCE` et sa source. Puis modéliser *pourquoi ce poste existe* et à quoi ressemble réellement le candidat attendu.
3. **Vous évaluer** — un score sur 100, décomposé en quatre filtres qui correspondent aux quatre moments où une candidature meurt : le **tri automatique (ATS)**, la **présélection RH**, le **hiring manager**, et le **fit stratégique**.
4. **Vous attaquer** — un agent adversarial cherche les raisons de vous rejeter en 20 secondes, un autre vous compare au vivier probable de candidats.
5. **Réécrire** — un plan d'amélioration classé par retour sur effort, puis un CV et une lettre réécrits.
6. **Vérifier** — et c'est le cœur du système : un contrôleur qualité relit chaque phrase réécrite et **bloque tout ce qui n'est pas prouvé par votre CV d'origine.**

Vous corrigez, vous re-déposez une v2, et le système compare : ce qui a progressé, ce qui a régressé, ce qui bloque encore. Jusqu'à ce qu'il vous dise soit *c'est prêt*, soit — et c'est tout aussi utile — *le document a atteint son plafond, l'écart restant est une vraie différence d'expérience, arrêtez de réécrire et changez de canal.*

---

## La règle qui compte

> **Le système n'a pas le droit d'inventer.**

Avant toute réécriture, un agent extrait de votre CV une **Evidence Bank** : la liste de ce que vous pouvez réellement prouver. Chaque phrase produite ensuite doit pointer vers une de ces preuves. Le contrôleur qualité bloque le reste — et quand il ne peut pas formuler quelque chose sans savoir, il laisse un marqueur explicite :

```
[À COMPLÉTER : le langage utilisé sur ce projet — je ne peux pas le déduire du CV]
```

C'est volontairement frustrant. C'est aussi le seul réglage qui rend l'outil utile : une candidature optimisée qui s'effondre à la première question d'entretien vous a fait perdre votre temps et celui du recruteur.

**Ce projet n'est pas un bourreur de mots-clés.** Il refuse d'insérer le vocabulaire d'un domaine que vous n'avez pas pratiqué, même quand ça ferait mécaniquement monter le score. Il est là pour vous aider à **dire mieux ce qui est vrai** — pas à dire autre chose.

---

## Démarrage

```bash
git clone https://github.com/spykernv/open-ats.git
cd open-ats
npm install
```

### Voir à quoi ça ressemble, en 2 minutes et sans rien consommer

Le mode `mock` remplit la pipeline avec des données factices : parfait pour visiter l'interface avant de décider si le projet vous intéresse.

```bash
LLM_PROVIDER=mock MOCK_DELAY_MS=1200 npm start
```

Puis, dans un second terminal :

```bash
npm run demo
```

Une candidature fictive complète est créée et analysée de bout en bout. Ouvrez **http://localhost:3777**.

### Pour de vrai

**Aucune clé API n'est nécessaire.** Par défaut, le moteur est **votre propre session d'agent** : l'application dépose chaque étape dans une file de fichiers, votre agent la prend, fait le travail lui-même (lire les captures d'écran et les PDF, chercher sur le web, rédiger, produire le JSON), et répond.

```bash
npm start
```

Puis, **dans votre session Claude Code** (ou dans n'importe quel agent, voir plus bas) :

```bash
npm run bridge
```

Ouvrez **http://localhost:3777**. L'encart « Pont Claude » de la barre latérale vous dit en direct si une session écoute, ce qu'elle traite, et ce qui attend dans la file. Si le pont se déconnecte, la pipeline **attend** — elle n'échoue pas. Relancez `npm run bridge` et elle repart.

---

## N'importe quel agent peut le faire tourner

Le pont n'est pas une intégration : c'est **un répertoire de fichiers**.

```
bridge/queue/<jobId>/
├── job.json      ← métadonnées de l'étape (titre, fichiers à lire, web search attendu ?)
├── prompt.md     ← le prompt complet
├── schema.json   ← le JSON Schema auquel la réponse doit se conformer
└── result.json   ← ce que l'agent écrit  (c'est tout)
```

Le serveur valide `result.json` contre le schéma Zod de l'étape. S'il n'est pas conforme, il republie automatiquement un job de correction contenant l'erreur exacte. Aucun secret ne transite, aucun sous-processus n'est lancé : **tout agent capable de lire et d'écrire des fichiers peut être le moteur de ce système.** `bridge/cli.mjs` (`wait` / `status` / `show` / `answer` / `fail`) n'est qu'un confort par-dessus.

---

## Comment ça marche

```mermaid
flowchart TB
  IN["📄 Annonce · 📄 CV · ✉️ Lettre"] --> P1

  subgraph P1["1 · Comprendre le poste"]
    direction LR
    a1["job_parser<br/>annonce → critères"] --> a2["company_researcher<br/>web, sources tracées"] --> a3["recruiting_modeler<br/>pourquoi ce poste existe"] --> a4["opportunity_scorer<br/>/100"]
  end

  subgraph P2["2 · Prouver"]
    direction LR
    b1["cv_extractor<br/>Evidence Bank"] --> b2["requirement_mapper<br/>critère → preuve"]
  end

  subgraph P3["3 · Juger"]
    direction LR
    c1["cv_evaluator<br/>ATS · RH · HM · Fit"] --> c2["adversarial_reviewer"]
    c1 --> c3["competitive_benchmark"]
    c1 --> c4["letter_evaluator"]
  end

  subgraph P4["4 · Réécrire"]
    direction LR
    d1["improvement_planner<br/>classé par ROI"] --> d2["cv_optimizer"] --> d4["quality_controller<br/>bloque le non-prouvé"]
    d1 --> d3["letter_optimizer"] --> d4
  end

  subgraph P5["5 · Décider"]
    direction LR
    e1["version_comparator"] --> e2["verdict + rapport"]
  end

  P1 --> P2 --> P3 --> P4 --> P5
```

Le verdict final (`APPLY NOW` / `IMPROVE FIRST` / `LOW PRIORITY` / `DO NOT APPLY`) est **calculé en code**, pas par le modèle — même entrée, même sortie, toujours. Idem pour le rapport Markdown et les exports PDF : ils sont assemblés à partir des artefacts JSON, sans appel au modèle.

Les étapes partagées (offre, recherche entreprise, thèse, opportunité) ne sont calculées qu'une fois par candidature et réutilisées d'une version à l'autre.

---

## L'interface

<table>
<tr>
<td width="50%"><img src="docs/screenshots/02-synthese.png" alt="Scores et verdict"></td>
<td width="50%"><img src="docs/screenshots/03-requirements.png" alt="Matrice critère vers preuve"></td>
</tr>
<tr>
<td><b>Synthèse</b> — sept scores, le verdict, l'évolution depuis la version précédente, et les risques de rejet en 20 secondes.</td>
<td><b>Requirements &amp; Evidence</b> — chaque critère de l'annonce face à ce que votre CV prouve réellement, avec la distinction cruciale entre <i>défaut de positionnement</i> (réparable en réécrivant) et <i>écart d'expérience réel</i> (non réparable).</td>
</tr>
<tr>
<td><img src="docs/screenshots/04-cv-optimise.png" alt="CV optimisé et contrôle d'intégrité"></td>
<td><img src="docs/screenshots/01-dashboard.png" alt="Tableau de bord des candidatures"></td>
</tr>
<tr>
<td><b>CV optimisé</b> — la réécriture, le détail avant/après puce par puce, et le contrôle d'intégrité qui a validé (ou bloqué) chaque phrase.</td>
<td><b>Tableau de bord</b> — toutes vos candidatures classées par score, avec leur verdict, leur version et leur statut d'envoi.</td>
</tr>
</table>

<details>
<summary><b>Voir les autres écrans</b> (nouvelle analyse, recherche entreprise, console)</summary>
<br>

| | |
|---|---|
| <img src="docs/screenshots/06-nouvelle-analyse.png" alt="Nouvelle analyse"> | **Nouvelle analyse** — déposez l'annonce, le CV, la lettre. La lettre est optionnelle : sans elle, le système en rédige une depuis votre Evidence Bank. |
| <img src="docs/screenshots/05-recherche.png" alt="Recherche entreprise"> | **Entreprise & Thèse** — la recherche web, chaque constat étiqueté par niveau de confiance et sourcé, puis la modélisation du recrutement. |
| <img src="docs/screenshots/07-console.png" alt="Console Claude"> | **Console** — une question libre à votre agent, avec accès à vos dossiers d'analyse : « compare ces deux candidatures », « relis cette puce ». |

*(Captures prises en mode démo — les mentions `[MOCK]` sont les données factices du mode hors-ligne.)*

</details>

---

## Les moteurs

Le moteur se change **à chaud** depuis l'interface, sans redémarrer le serveur.

| Moteur | Ce que c'est | Clé API |
|---|---|:---:|
| **`claude-session`** *(défaut)* | Votre session d'agent exécute chaque étape via le pont. Vous voyez tout ce qui se passe, vous pouvez intervenir. | non |
| `claude-cli` | Sous-processus `claude -p` en headless. Même abonnement, sans supervision. Outils d'écriture désactivés par sécurité. | non |
| `anthropic` | API Anthropic directe : sorties structurées natives, streaming, thinking adaptatif. | oui |
| `mock` | Données factices, pour explorer l'interface ou développer sans rien consommer. | non |

Ajouter un moteur = **ajouter un fichier** dans `server/llm/`. Les messages de la pipeline sont agnostiques (`{type: "text" | "file"}`) ; c'est le provider qui décide comment matérialiser les fichiers.

---

## Vos données ne quittent jamais votre machine

Ce point n'est pas négociable, alors il est câblé dans le projet plutôt que promis dans une doc :

- Tout vit dans `applications/<id>/` sur **votre disque**. Aucun service tiers, aucune base de données, aucune télémétrie.
- `applications/`, `bridge/queue/`, `bridge/archive/` et `.env` sont **git-ignorés**. Vous ne pouvez pas committer votre CV par accident.
- En mode `claude-session`, le pont ne transporte que des fichiers locaux — aucun secret n'y transite.
- Les exports PDF sont rendus en local par `pdfkit`. Pas de navigateur headless, pas de service de conversion.

Ce dépôt ne contient aucune candidature réelle : le seul jeu de données est fictif et généré par `npm run demo`.

---

## Aller plus loin

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — la carte du code, le détail des 16 étapes, l'API HTTP, et comment brancher votre propre moteur ou moteur de recherche.
- `server/prompts/*.md` — **les prompts sont en clair, un fichier par agent.** C'est là que se trouve la vraie substance du projet : lisez `_core_rules.md` en premier, c'est le contrat d'intégrité que tous les agents partagent.

### Tests

```bash
npm run test:bridge
```
Teste le pont seul (file de jobs, validation de schéma, réparation automatique). Aucun serveur, aucune session requise.

```bash
LLM_PROVIDER=mock npm start     # puis, dans un autre terminal :
npm test
```
Test de bout en bout : création, pipeline 16 étapes, rapport, dépôt d'une v2, ré-évaluation, comparaison. En mode mock, ne consomme rien.

---

## Reprenez-le, cassez-le, améliorez-le

Le projet est sous licence MIT : faites-en ce que vous voulez. Quelques pistes si l'envie vous prend :

- **Adaptez les prompts à votre métier.** Ils sont calibrés pour des profils junior/VIE en business et data. Un profil senior, un poste d'ingénieur ou un marché non francophone méritent d'autres réglages — tout est dans `server/prompts/`.
- **Branchez votre agent.** Le pont est du système de fichiers : si votre agent lit et écrit des fichiers, il peut être le moteur.
- **Ajoutez un filtre.** Le modèle à quatre filtres reflète ma compréhension du processus de recrutement. La vôtre est peut-être meilleure.

Les issues et les PR sont bienvenues, et les retours d'expérience encore plus — surtout si vous l'avez utilisé pour de vrai. Si une partie du code n'est pas claire, c'est un défaut de ma part : ouvrez une issue, je corrigerai.

---

## Un mot si vous cherchez un poste

Chercher du travail, c'est épuisant, et un refus automatique ne vous dit jamais pourquoi. C'est ce silence-là que cet outil essaie de combler : pas pour vous faire passer pour quelqu'un d'autre, mais pour que vous sachiez enfin **où vous en êtes vraiment** — et que vous puissiez investir votre énergie là où elle change quelque chose.

Parfois, la réponse la plus utile que donne ce système est « cette candidature est structurellement faible, arrêtez de réécrire ». Ça fait un peu mal sur le moment. Ça économise des semaines.

Bon courage, sincèrement. Vous valez mieux que ce qu'un premier tri automatique dit de vous.

---

<div align="center">

**Jonathan Naal** · [LinkedIn](https://www.linkedin.com/in/jonathannaal/)

Si ce projet vous sert à quelque chose, dites-le moi — c'est la meilleure des contreparties.

<sub>MIT · Ce projet n'est affilié à aucun éditeur d'ATS ni à aucun fournisseur de modèles.</sub>

</div>
