# Portefeuille Fidélité

Webapp pour ranger ses cartes de fidélité (Leclerc Drive, Chronodrive, Carrefour…) et afficher leur code-barres en caisse.

- Connexion par **email + mot de passe** (création de compte, mot de passe oublié).
- Cartes synchronisées entre téléphone et PC (Firebase Firestore), chaque compte ne voit que ses cartes.
- Ajout d'une carte en **scannant le code-barres avec la caméra**, depuis une photo, ou en saisissant le numéro.
- EAN-13, EAN-8, Code 128, Code 39, UPC, ITF, QR code.
- Fonctionne **hors ligne** une fois ouverte une première fois (pratique au fond du magasin).
- Installable sur l'écran d'accueil du téléphone.

| Brique | Service | Coût |
|---|---|---|
| Hébergement | GitHub Pages | gratuit |
| Comptes et données | Firebase (même projet que Pronos Foot) | gratuit |

## Mise en route

### 1. Publier le site (GitHub Pages)
1. Sur github.com : **Settings → Pages** du dépôt `cartes-fidelite`.
2. Source = *Deploy from a branch*, branche `main`, dossier `/ (root)` → **Save**.
3. Au bout d'une minute, le site est en ligne : `https://tonychev.github.io/cartes-fidelite/`

### 2. Activer la connexion par email (Firebase)
L'appli utilise le projet Firebase de Pronos Foot (`pronos-foot-fad76`).
1. https://console.firebase.google.com → projet **pronos-foot** → **Build → Authentication → Sign-in method**.
2. **Ajouter un fournisseur → E-mail/Mot de passe** → activer le premier interrupteur (pas besoin du « lien par email ») → **Enregistrer**.
3. Onglet **Settings → Authorized domains** : `tonychev.github.io` doit y être (déjà le cas pour Pronos Foot).
4. Facultatif : **Authentication → Templates → Réinitialisation du mot de passe** → langue *français*.

Les règles Firestore de Pronos Foot couvrent déjà les cartes : elles sont rangées dans `users/<uid>/cartes`,
et la règle `match /users/{userId}/{document=**}` réserve ces données à leur propriétaire. Rien à changer.

### 3. Sur le téléphone
Ouvre l'adresse du site → crée ton compte → menu ⋮ (Chrome) ou bouton Partager (Safari) → **Ajouter à l'écran d'accueil**.

## Développement local
```bash
python3 -m http.server 8765    # puis ouvrir http://localhost:8765
```
Pour la connexion en local, ajoute `localhost` aux *Authorized domains* de Firebase (souvent déjà présent).
