
  // Shared data loader. Two shells fetch this verbatim as their first script —
  // mendes/map/ and mendes/journey/ — so the claims and their citations have a
  // single home and a correction reaches both viewers. It opens the async IIFE
  // that each shell's last file closes: do not close it here, and do not move
  // the opening line, or the concatenated body stops parsing on both pages.
  //
  // The records themselves live in ../data/claims.json (one directory up from
  // either page, so the same relative URL works for both shells). This file
  // keeps only what is viewer furniture rather than evidence: the derived
  // indexes and the map geometry (labels, corridors, convergence).
  (async function () {
    "use strict";

    const claimsUrl = "../data/claims.json?v="
      + encodeURIComponent(window.ASSET_VERSION || window.JOURNEY_VERSION || "");
    const claimsResponse = await fetch(claimsUrl);
    if (!claimsResponse.ok) throw new Error("Could not load " + claimsUrl + ": " + claimsResponse.status);
    const claimsData = await claimsResponse.json();

    // Recipe colors live in site.css (--mendesian / --metopion / --susinum);
    // everything here paints through CSS classes keyed by these ids.
    const recipes = claimsData.recipes;
    const ingredients = claimsData.ingredients;
    const contextIngredients = claimsData.contextIngredients;
    const theology = claimsData.theology;

    const allIngredients = ingredients.concat(contextIngredients, [theology]);
    const ingredientGroups = claimsData.ingredientGroups;
    const ingredientGroupShortLabels = claimsData.ingredientGroupShortLabels;
    const ingredientById = new Map(allIngredients.map(function (ingredient) { return [ingredient.id,ingredient]; }));
    const ingredientGroupById = new Map();
    const orderedIngredients = [];
    ingredientGroups.forEach(function (group) {
      group.ids.forEach(function (id) {
        const ingredient = ingredientById.get(id);
        if (!ingredient) return;
        ingredientGroupById.set(id,group);
        orderedIngredients.push(ingredient);
      });
    });
    allIngredients.forEach(function (ingredient) {
      if (!ingredientGroupById.has(ingredient.id)) orderedIngredients.push(ingredient);
    });
    const claims = [];
    allIngredients.forEach(function (ingredient) {
      ingredient.claims.forEach(function (claim) {
        claim.ingredient = ingredient.id;
        claim.greek = ingredient.greek;
        claim.translit = ingredient.translit;
        claim.gloss = ingredient.gloss;
        claim.context = !!ingredient.context;
        claims.push(claim);
      });
    });

    const ancientLabels = [
      { text:"AEGYPT", coord:[29.0,26.1], cls:"region-label" },
      { text:"THEBAID", coord:[30.6,24.2], cls:"region-label" },
      { text:"LIBYA", coord:[18.0,27.0], cls:"region-label" },
      { text:"JUDAEA", coord:[34.2,31.2], cls:"region-label" },
      { text:"PHOENICIA", coord:[34.6,33.6], cls:"region-label" },
      { text:"SYRIA", coord:[38.0,34.7], cls:"region-label" },
      { text:"CILICIA", coord:[34.2,37.3], cls:"region-label" },
      { text:"PAMPHYLIA", coord:[30.4,37.0], cls:"region-label" },
      { text:"ARMENIA", coord:[44.7,41.3], cls:"region-label" },
      { text:"MEDIA", coord:[50.3,34.0], cls:"region-label" },
      { text:"NABATAEA", coord:[37.5,29.1], cls:"region-label" },
      { text:"ARABIA", coord:[48.0,19.3], cls:"region-label" },
      { text:"ETHIOPIA", coord:[37.5,8.0], cls:"region-label" },
      { text:"INDIA", coord:[72.0,25.0], cls:"region-label" },
      { text:"SICILY", coord:[13.8,38.5], cls:"region-label" },
      { text:"CYCLADES", coord:[24.7,35.9], cls:"region-label" }
    ];

    const placeLabels = [
      { text:"Corycus", coord:[34.0,36.45], dx:6, dy:-6 },
      { text:"Side", coord:[31.39,36.77], dx:6, dy:13 },
      { text:"Athens", coord:[23.7,37.9], dx:9, dy:-12 },
      { text:"Jericho", coord:[35.44,31.87], dx:6, dy:-5 },
      { text:"Petra", coord:[35.44,30.33], dx:6, dy:13 },
      { text:"Gaza", coord:[34.47,31.5], dx:-26, dy:-6 },
      { text:"Coptos", coord:[32.8,26.0], dx:6, dy:-6 },
      { text:"Myos Hormos", coord:[33.6,27.2], dx:7, dy:-5 },
      { text:"Berenice", coord:[35.5,23.9], dx:7, dy:12 }
    ];

    const routes = [
      { id:"india-sea", type:"sea", coords:[[72.5,19.0],[61.0,15.5],[49.2,12.7],[43.3,12.6],[39.5,17.0],[35.5,23.9]], label:"INDIA → RED SEA · SEA", labelAt:[55.0,11.6] },
      { id:"red-sea", type:"sea", coords:[[43.3,12.6],[40.0,16.0],[37.7,20.0],[35.5,23.9],[33.6,27.2]], label:"RED SEA PORTS · SEA", labelAt:[41.0,18.6] },
      { id:"berenice-coptos", type:"land", coords:[[35.5,23.9],[34.2,25.0],[32.8,26.0]], label:"BERENICE → COPTOS · LAND", labelAt:[35.0,24.6] },
      { id:"myos-coptos", type:"land", coords:[[33.6,27.2],[32.8,26.0]], label:"MYOS HORMOS → COPTOS · LAND", labelAt:[33.8,27.0] },
      { id:"nile", type:"river", coords:[[32.8,26.0],[31.7,28.4],[31.2,30.1],[31.5,30.95]], label:"NILE · CONVENTIONAL", labelAt:[29.4,28.7] },
      { id:"incense-road", type:"land", coords:[[44.2,15.4],[39.7,21.4],[37.4,26.6],[35.44,30.33],[34.47,31.5],[31.5,30.95]], label:"PETRA → GAZA · LAND", labelAt:[42.0,27.2] },
      { id:"med-sea", type:"sea", coords:[[14.0,37.5],[23.7,37.9],[30.0,36.2],[33.3,35.0],[29.9,31.2],[31.5,30.95]], label:"MEDITERRANEAN · SEA", labelAt:[17.5,35.0] },
      { id:"syria-land", type:"land", coords:[[36.3,36.6],[36.3,33.5],[34.47,31.5],[31.5,30.95]], label:"SYRIA · LAND", labelAt:[38.0,33.6] }
    ];

    const convergence = {
      med: [[29.9,31.2],[31.5,30.95]],
      incense: [[35.44,30.33],[34.47,31.5],[31.5,30.95]],
      redsea: [[35.5,23.9],[32.8,26.0],[31.5,30.95]],
      nile: [[32.8,26.0],[31.5,30.95]],
      syria: [[36.3,33.5],[34.47,31.5],[31.5,30.95]],
      india: [[43.3,12.6],[35.5,23.9],[32.8,26.0],[31.5,30.95]]
    };
