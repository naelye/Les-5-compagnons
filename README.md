# Les Cinq Compagnons

Jeu de cartes en ligne, 2 à 7 joueurs, sans compte. Aucune dépendance : Node 18+ suffit.

## Lancer en local
    node server.js
puis ouvrir http://localhost:3000

## Déployer sur Render (offre gratuite)
1. Mettez ce dossier dans un dépôt GitHub.
2. Sur render.com : New → Web Service → choisissez le dépôt.
3. Runtime : Node. Build Command : (vide ou `echo ok`). Start Command : `node server.js`. Instance Type : Free.
4. Une fois « Live », l'adresse `https://….onrender.com` est celle de votre site.

Remarque : sur l'offre gratuite, le serveur s'endort après 15 min sans activité et met environ une minute à se réveiller.
Les parties sont gardées en mémoire : un redémarrage du serveur les efface.
