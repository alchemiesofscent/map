
  // Shared data file. Two shells fetch this verbatim as their first script —
  // mendes/map/ and mendes/journey/ — so the claims and their citations have a
  // single home and a correction reaches both viewers. It opens the async IIFE
  // that each shell's last file closes: do not close it here, and do not move
  // the opening line, or the concatenated body stops parsing on both pages.
  (async function () {
    "use strict";

    // Recipe colors live in site.css (--mendesian / --metopion / --susinum);
    // everything here paints through CSS classes keyed by these ids.
    const recipes = {
      m: { name: "Dark Mendesian" },
      t: { name: "Metopion" },
      s: { name: "Susinum" }
    };

    const ingredients = [
      {
        id: "balanos",
        greek: "ἔλαιον βαλάνινον / βάλανος μυρεψική",
        translit: "elaion balaninon / balanos myrepsikē",
        gloss: "balanos oil / perfumers’ balanos nut",
        recipes: ["m", "s"],
        claims: [
          { id:"bal-trog", place:"Troglodytic coast", coord:[38.5,17.5], evidence:"ancient", route:"redsea", recipes:["m","s"], cite:"Pliny, Naturalis historia 12.100–102", note:"Common to the Troglodytes; the Troglodytic grade is described as the cheapest. This maps the ancient grade claim, not a modern species range." },
          { id:"bal-thebaid", place:"Thebaid", coord:[32.7,25.7], evidence:"ancient", route:"nile", recipes:["m","s"], cite:"Pliny, Naturalis historia 12.100–101", note:"The Thebaid grade is black and abundant." },
          { id:"bal-arabia", place:"Arabia between Judaea and Egypt", coord:[35.3,29.0], evidence:"ancient", route:"incense", recipes:["m","s"], cite:"Pliny, Naturalis historia 12.100–101", note:"Pliny locates an Arabian grade in the tract separating Judaea from Egypt and says the Arabian kind is called ‘Syrian’." },
          { id:"bal-ethiopia", place:"Ethiopia", coord:[39.0,10.3], evidence:"ancient", route:"redsea", recipes:["m","s"], cite:"Pliny, Naturalis historia 12.101", note:"Some authorities preferred an Ethiopian black grade." },
          { id:"bal-egypt", place:"Egypt", coord:[30.7,27.4], evidence:"ancient", route:"nile", recipes:["m","s"], cite:"Pliny, Naturalis historia 12.102", note:"The Egyptian grade is red, thick-shelled, and associated with swampy ground." },
          { id:"bal-petra", place:"Petra", coord:[35.44,30.33], evidence:"ancient", route:"incense", recipes:["m","s"], cite:"Pliny, Naturalis historia 12.102", note:"The Petraean grade, black-shelled with a white kernel, is ranked far above the others." }
        ]
      },
      {
        id: "myrrh",
        greek: "σμύρνα",
        translit: "smyrna",
        gloss: "myrrh",
        recipes: ["m","t","s"],
        claims: [
          { id:"myrrh-trog", place:"Troglodytic coast", coord:[39.1,16.2], evidence:"ancient", route:"redsea", recipes:["m","t","s"], cite:"Dioscorides, De materia medica 1.64; Pliny, Naturalis historia 12.69–70", note:"Both traditions rank a Troglodytic grade highly; Pliny makes it the first grade." },
          { id:"myrrh-arabia", place:"South Arabia", coord:[44.2,15.4], evidence:"ancient", route:"incense", recipes:["m","t","s"], cite:"Dioscorides, De materia medica 1.64; Pliny, Naturalis historia 12.66, 12.69–70", note:"Arabian claim. Pliny’s grade names include Minaean, Atramitic, Gebbanitic, Ausaritis, Dianitis, Sambracena, Dusaritis, and Mesalum; their precise point locations are not invented here." }
        ]
      },
      {
        id: "cassia",
        greek: "κασσία / κασία / σύριγξ",
        translit: "kassia / kasia / syrinx",
        gloss: "cassia / cassia quill or tube",
        recipes: ["m","s"],
        claims: [
          { id:"cassia-arabia", place:"Arabia — ancient claim", coord:[45.0,22.6], evidence:"ancient", route:"incense", recipes:["m","s"], cite:"Herodotus, Histories 3.110; Theophrastus, Historia plantarum 9.7.2; Dioscorides, De materia medica 1.13", note:"Herodotus, Theophrastus, and Dioscorides place cassia in Arabia or ‘aromatic-bearing Arabia’." },
          { id:"cassia-trog", place:"Ethiopia / Troglodytic cinnamon fields", coord:[40.0,14.6], evidence:"ancient", route:"redsea", recipes:["m","s"], cite:"Pliny, Naturalis historia 12.86, 12.95", note:"Pliny rejects Arabia for cinnamon, places its fields among Ethiopian Troglodytes, and says cassia grows beside them." },
          { id:"cassia-modern", place:"South / Southeast Asia — modern correction zone", coord:[79.6,10.4], evidence:"modern", subtype:"correction", route:null, recipes:["m","s"], cite:"Gilboa & Namdar, Radiocarbon 57.2 (2015), 265–283; Kew, Plants of the World Online", note:"Modern scholarship moves the plausible source-zone much farther east. This is a correction register, not a forced identification of Greek κασσία with one modern species." }
        ]
      },
      {
        id: "cinnamon",
        greek: "κινάμωμον",
        translit: "kinamōmon",
        gloss: "cinnamon",
        recipes: ["m","s"],
        claims: [
          { id:"cinn-arabia", place:"Arabia — ancient claim", coord:[46.0,21.5], evidence:"ancient", route:"incense", recipes:["m","s"], cite:"Herodotus, Histories 3.111; Theophrastus, Historia plantarum 9.7.2", note:"The Arabian claim is plotted as the ancient authors frame it, despite their own fabulous collection stories." },
          { id:"cinn-trog", place:"Ethiopia among the Troglodytes", coord:[40.7,13.3], evidence:"ancient", route:"redsea", recipes:["m","s"], cite:"Pliny, Naturalis historia 12.82–86", note:"Pliny explicitly says cinnamon is not Arabian and instead grows in Ethiopia among the Troglodytes." },
          { id:"cinn-modern", place:"South / Southeast Asia — modern correction zone", coord:[81.0,8.2], evidence:"modern", subtype:"correction", route:null, recipes:["m","s"], cite:"Gilboa & Namdar, Radiocarbon 57.2 (2015), 265–283; Kew, Plants of the World Online", note:"Archaeological review places ancient cinnamon’s source-zone in South/Southeast Asia; Kew gives Sri Lanka as the native range for true cinnamon. No Greek-to-species equation is imposed." }
        ]
      },
      {
        id: "resin",
        greek: "ῥητίνη / τερεβινθίνη",
        translit: "rhētinē / terebinthinē",
        gloss: "resin / terebinth resin",
        recipes: ["m","t"],
        claims: [
          { id:"resin-petra", place:"Petra in Arabia", coord:[35.7,30.1], evidence:"ancient", route:"incense", recipes:["m","t"], cite:"Dioscorides, De materia medica 1.71", note:"Terebinth resin is brought from Arabia at Petra." },
          { id:"resin-judaea", place:"Judaea", coord:[35.1,31.6], evidence:"ancient", route:"incense", recipes:["m","t"], cite:"Dioscorides, De materia medica 1.71", note:"One of the named producing regions for terebinth resin." },
          { id:"resin-syria", place:"Syria", coord:[36.7,34.8], evidence:"ancient", route:"syria", recipes:["m","t"], cite:"Dioscorides, De materia medica 1.71", note:"One of the named producing regions for terebinth resin." },
          { id:"resin-cyprus", place:"Cyprus", coord:[33.3,35.0], evidence:"ancient", route:"med", recipes:["m","t"], cite:"Dioscorides, De materia medica 1.71", note:"One of the named producing regions for terebinth resin." },
          { id:"resin-libya", place:"Libya", coord:[17.8,29.1], evidence:"ancient", route:"med", recipes:["m","t"], cite:"Dioscorides, De materia medica 1.71", note:"One of the named producing regions for terebinth resin." },
          { id:"resin-cyclades", place:"Cyclades", coord:[25.3,37.0], evidence:"ancient", route:"med", recipes:["m","t"], cite:"Dioscorides, De materia medica 1.71", note:"The Cycladic product is ranked by its clarity, whiteness, glassy appearance, and fragrance." }
        ]
      },
      {
        id: "almonds",
        greek: "ἀμύγδαλα πικρά",
        translit: "amygdala pikra",
        gloss: "bitter almonds",
        recipes: ["t"],
        claims: [
          { id:"almond-egypt", place:"Egypt — oil expression / manufacture", coord:[30.3,29.2], evidence:"ancient", route:"nile", recipes:["t"], cite:"Pliny, Naturalis historia 13.8; Dioscorides, De materia medica 1.59", note:"Pliny says bitter-almond oil for Metopion is expressed in Egypt; Dioscorides places the perfume’s preparation in Egypt. This is a production claim, not a growth range for the nut." }
        ]
      },
      {
        id: "omphacine",
        greek: "ἔλαιον ὀμφάκινον",
        translit: "elaion omphakinon",
        gloss: "omphacine oil",
        recipes: ["t"],
        claims: [
          { id:"omph-local", place:"Egyptian workshop context — source unstated", coord:[31.0,29.9], evidence:"modern", subtype:"inference", route:null, recipes:["t"], cite:"Dioscorides, De materia medica 1.59; Paul of Aegina, Epitome 7.20.16", note:"The recipe is Egyptian; neither checked passage states that the omphacine oil itself was pressed in or originated from Egypt." }
        ]
      },
      {
        id: "cardamom",
        greek: "καρδάμωμον",
        translit: "kardamōmon",
        gloss: "cardamom",
        recipes: ["t","s"],
        claims: [
          { id:"card-commagene", place:"Commagene", coord:[38.2,37.4], evidence:"ancient", route:"syria", recipes:["t","s"], cite:"Dioscorides, De materia medica 1.6", note:"Dioscorides ranks the Commagene product among the best." },
          { id:"card-armenia", place:"Armenia", coord:[44.5,40.2], evidence:"ancient", route:"syria", recipes:["t","s"], cite:"Dioscorides, De materia medica 1.6", note:"Dioscorides ranks the Armenian product among the best." },
          { id:"card-bosporus", place:"Bosporus — textual referent unresolved", coord:[36.5,45.1], evidence:"ancient", route:"syria", recipes:["t","s"], cite:"Dioscorides, De materia medica 1.6", note:"The source says Bosporus. The point is placed approximately at the Cimmerian Bosporus; the passage itself does not disambiguate the toponym." },
          { id:"card-india", place:"India", coord:[73.3,22.2], evidence:"ancient", route:"india", recipes:["t","s"], cite:"Dioscorides, De materia medica 1.6; Theophrastus, Historia plantarum 9.7.2", note:"Dioscorides says it also grows in India; Theophrastus reports India as one of two competing origins." },
          { id:"card-media", place:"Media", coord:[49.3,34.2], evidence:"ancient", route:"syria", recipes:["t","s"], cite:"Theophrastus, Historia plantarum 9.7.2; Pliny, Naturalis historia 12.50", note:"Media is one side of Theophrastus’ reported disagreement and also appears in Pliny." },
          { id:"card-arabia", place:"Arabia", coord:[47.3,24.5], evidence:"ancient", route:"incense", recipes:["t","s"], cite:"Dioscorides, De materia medica 1.6; Pliny, Naturalis historia 12.50", note:"Dioscorides says it also grows in Arabia; Pliny says it is harvested there." }
        ]
      },
      {
        id: "schoinos",
        greek: "σχοῖνος / σχοίνου ἄνθος",
        translit: "schoinos / schoinou anthos",
        gloss: "aromatic rush / rush-flower",
        recipes: ["t"],
        claims: [
          { id:"rush-nabataea", place:"Nabataea", coord:[35.1,30.7], evidence:"ancient", route:"incense", recipes:["t"], cite:"Dioscorides, De materia medica 1.17", note:"The Nabataean rush is ranked best." },
          { id:"rush-arabia", place:"Arabia", coord:[42.3,25.2], evidence:"ancient", route:"incense", recipes:["t"], cite:"Dioscorides, De materia medica 1.17", note:"The Arabian rush is ranked second." },
          { id:"rush-libya", place:"Libya", coord:[15.7,31.2], evidence:"ancient", route:"med", recipes:["t"], cite:"Dioscorides, De materia medica 1.17", note:"The Libyan rush is named but dismissed as useless." },
          { id:"rush-lebanon", place:"Valley beyond Lebanon", coord:[35.8,33.7], evidence:"ancient", route:"syria", recipes:["t"], cite:"Theophrastus, Historia plantarum 9.7.1; Pliny, Naturalis historia 12.104–106", note:"Aromatic rush and reed are said to grow in a valley beyond Lebanon beside a seasonal lake." },
          { id:"rush-campania", place:"Campania — reported", coord:[14.7,40.8], evidence:"ancient", route:"med", recipes:["t"], cite:"Pliny, Naturalis historia 12.106", note:"Pliny reports that the fragrant rush is also found in Campania." }
        ]
      },
      {
        id: "kalamos",
        greek: "κάλαμος ἀρωματικός",
        translit: "kalamos aromatikos",
        gloss: "aromatic reed",
        recipes: ["t","s"],
        claims: [
          { id:"reed-india", place:"India", coord:[75.0,20.2], evidence:"ancient", route:"india", recipes:["t","s"], cite:"Dioscorides, De materia medica 1.18; Pliny, Naturalis historia 12.104", note:"Dioscorides places it in India; Pliny says it is common to India, Arabia, and Syria." },
          { id:"reed-arabia", place:"Arabia", coord:[49.0,22.2], evidence:"ancient", route:"incense", recipes:["t","s"], cite:"Pliny, Naturalis historia 12.104", note:"Pliny names Arabia among the regions of aromatic calamus." },
          { id:"reed-syria", place:"Syria / Lebanon valley", coord:[36.1,34.0], evidence:"ancient", route:"syria", recipes:["t","s"], cite:"Theophrastus, Historia plantarum 9.7.1; Pliny, Naturalis historia 12.104–106", note:"The Lebanon-valley claim is explicit; Pliny says Syrian calamus surpasses all." }
        ]
      },
      {
        id: "honey",
        greek: "μέλι / μέλι Ἀττικόν",
        translit: "meli / meli Attikon",
        gloss: "honey / Attic honey",
        recipes: ["t","s"],
        claims: [
          { id:"honey-attica", place:"Attica", coord:[23.7,37.9], evidence:"ancient", route:"med", recipes:["t"], cite:"Paul of Aegina, Epitome 7.20.16", note:"Paul explicitly specifies Attic honey for Metopion." },
          { id:"honey-local", place:"Susinum workshop context — source unstated", coord:[31.8,30.45], evidence:"modern", subtype:"inference", route:null, recipes:["s"], cite:"Dioscorides, De materia medica 1.52.1–4", note:"Honey coats hands and vessels in the Susinum procedure, but no geographic origin is stated. The point marks local handling only." }
        ]
      },
      {
        id: "wine",
        greek: "οἶνος / οἶνος εὐώδης",
        translit: "oinos / oinos euōdēs",
        gloss: "wine / fragrant wine",
        recipes: ["t","s"],
        claims: [
          { id:"wine-aegean", place:"Aegean supply — working inference", coord:[27.0,36.6], evidence:"modern", subtype:"inference", route:"med", recipes:["t","s"], cite:"Dioscorides, De materia medica 1.52, 1.59; Paul of Aegina, Epitome 7.20.16", note:"The recipes specify wine or fragrant wine but no origin. An Aegean supply is a working reconstruction only, routed on the conventional Mediterranean lane." }
        ]
      },
      {
        id: "balsam",
        greek: "καρπὸς βαλσάμου / καρποβάλσαμον",
        translit: "karpos balsamou / karpobalsamon",
        gloss: "balsam fruit / balsam seed",
        recipes: ["t"],
        claims: [
          { id:"balsam-judaea", place:"Judaea", coord:[35.0,31.3], evidence:"ancient", route:"incense", recipes:["t"], cite:"Pliny, Naturalis historia 12.111–123", note:"Pliny says balsam was granted to Judaea alone and describes two royal gardens. He does not name En Gedi in this passage." },
          { id:"balsam-jericho", place:"Jericho", coord:[35.44,31.87], evidence:"ancient", route:"incense", recipes:["t"], cite:"Josephus, Bellum Judaicum 4.469", note:"Josephus names Jericho as a producer of opobalsam, alongside henna and myrobalanos." }
        ]
      },
      {
        id: "galbanum",
        greek: "χαλβάνη",
        translit: "chalbanē",
        gloss: "galbanum",
        recipes: ["t"],
        claims: [
          { id:"galbanum-syria", place:"Syria / Mount Amanus", coord:[36.3,36.6], evidence:"ancient", route:"syria", recipes:["t"], cite:"Dioscorides, De materia medica 3.83; Pliny, Naturalis historia 12.126", note:"Dioscorides gives Syria; Pliny specifies Mount Amanus in Syria." }
        ]
      },
      {
        id: "saffron",
        greek: "κρόκος / κρόκος Κιλίκιος",
        translit: "krokos / krokos Kilikios",
        gloss: "saffron / Cilician saffron",
        recipes: ["s"],
        claims: [
          { id:"saff-corycus", place:"Corycus in Cilicia", coord:[34.0,36.45], evidence:"ancient", route:"med", recipes:["s"], cite:"Dioscorides, De materia medica 1.26; Paul of Aegina, Epitome 7.20.8", note:"The Corycian grade is ranked best; Paul explicitly specifies Cilician saffron." },
          { id:"saff-lycia", place:"Corycus near Lycia and Olympus", coord:[30.2,36.2], evidence:"ancient", route:"med", recipes:["s"], cite:"Dioscorides, De materia medica 1.26", note:"A second Corycian grade associated with Lycia and Olympus in the transmitted regional ranking." },
          { id:"saff-aegae", place:"Aegae in Aeolis", coord:[26.9,38.8], evidence:"ancient", route:"med", recipes:["s"], cite:"Dioscorides, De materia medica 1.26", note:"A named regional grade in Dioscorides’ ranking." },
          { id:"saff-cyrene", place:"Cyrene", coord:[21.86,32.82], evidence:"ancient", route:"med", recipes:["s"], cite:"Dioscorides, De materia medica 1.26", note:"The Cyrenaic grade is named but ranked weaker." },
          { id:"saff-sicily", place:"Sicily", coord:[14.0,37.5], evidence:"ancient", route:"med", recipes:["s"], cite:"Dioscorides, De materia medica 1.26", note:"The Sicilian grade is named but ranked weaker." }
        ]
      },
      {
        id: "lily",
        greek: "κρίνον / λείριον",
        translit: "krinon / leirion",
        gloss: "lily",
        recipes: ["s"],
        claims: [
          { id:"lily-phoenicia", place:"Phoenicia — finished Susinum", coord:[35.2,33.25], evidence:"ancient", route:"med", recipes:["s"], cite:"Dioscorides, De materia medica 1.52.5", note:"Dioscorides says Susinum made in Phoenicia is regarded as best. This is product provenance, not a claim about where lilies grew." },
          { id:"lily-egypt", place:"Egypt — finished Susinum", coord:[30.0,28.1], evidence:"ancient", route:"nile", recipes:["s"], cite:"Dioscorides, De materia medica 1.52.5", note:"Dioscorides says Susinum made in Egypt is regarded as best. This is product provenance, not a flower-growth claim." },
          { id:"lily-local", place:"Local flower supply — working inference", coord:[32.2,30.9], evidence:"modern", subtype:"inference", route:null, recipes:["s"], cite:"Dioscorides, De materia medica 1.52.1–5", note:"Fresh lilies are repeatedly charged into the oil, but the recipe gives no origin. A local workshop supply is plausible and deliberately dashed." }
        ]
      },
      {
        id: "oil",
        greek: "ἔλαιον / ἄλλο ἔλαιον",
        translit: "elaion / allo elaion",
        gloss: "oil / another oil",
        recipes: ["s"],
        claims: [
          { id:"oil-local", place:"Workshop oil — source unstated", coord:[31.35,30.25], evidence:"modern", subtype:"inference", route:null, recipes:["s"], cite:"Dioscorides, De materia medica 1.52.1–5; Paul of Aegina, Epitome 7.20.8", note:"The compound recipe says oil; the simple recipe allows balanos oil or another oil. No geographic origin is stated for the generic oil." }
        ]
      },
      {
        id: "water",
        greek: "ὕδωρ ὄμβριον / ὕδωρ",
        translit: "hydōr ombrion / hydōr",
        gloss: "rainwater / water",
        recipes: ["s"],
        claims: [
          { id:"water-local", place:"Workshop water — source unstated", coord:[31.65,30.1], evidence:"modern", subtype:"inference", route:null, recipes:["s"], cite:"Dioscorides, De materia medica 1.52.1, 1.52.4", note:"Rainwater is specified for soaking cardamom; geography is not. No route is drawn." }
        ]
      },
      {
        id: "salt",
        greek: "ἅλες λεπτοί",
        translit: "hales leptoi",
        gloss: "fine salt",
        recipes: ["s"],
        claims: [
          { id:"salt-local", place:"Workshop salt — source unstated", coord:[31.95,30.0], evidence:"modern", subtype:"inference", route:null, recipes:["s"], cite:"Dioscorides, De materia medica 1.52.2–3", note:"Fine salt is sprinkled during handling; the recipe gives no origin. No route is drawn." }
        ]
      },
      {
        id: "gum",
        greek: "κόμμι",
        translit: "kommi",
        gloss: "gum",
        recipes: ["s"],
        claims: [
          { id:"gum-local", place:"Vessel-dressing gum — source unstated", coord:[32.25,30.15], evidence:"modern", subtype:"inference", route:null, recipes:["s"], cite:"Dioscorides, De materia medica 1.52.4", note:"Gum appears in the dressing of dry vessels, not as a separately provenanced botanical ingredient. No route is drawn." }
        ]
      },
      {
        id: "karpesion",
        greek: "καρπήσιον",
        translit: "karpēsion",
        gloss: "carpesium (conventional name; no taxon imposed)",
        recipes: ["s"],
        claims: [
          { id:"karp-side", place:"Side in Pamphylia", coord:[31.39,36.77], evidence:"ancient", route:"med", recipes:["s"], cite:"Galen, De antidotis 1.14 (Kühn XIV 71–72)", note:"Galen says καρπήσιον is most abundant and cheapest at Side in Pamphylia; Paul transmits it as a Susinum substitute." }
        ]
      },
      {
        id: "arnabo",
        greek: "ἀρναβώ",
        translit: "arnabō",
        gloss: "unidentified aromatic substitute",
        recipes: ["s"],
        claims: [],
        unlocated: "Paul of Aegina, Epitome 7.20.8 names ἀρναβώ as an alternative to κινάμωμον but supplies no origin. No dot is plotted."
      }
    ];

    const contextIngredients = [
      {
        id: "hammoniacum-metopon",
        greek: "ἀμμωνιακόν / μέτωπον",
        translit: "ammōniakon / metōpon",
        gloss: "hammoniacum / the tree called metopon",
        recipes: ["t"],
        context: true,
        claims: [
          {
            id:"hammoniacum-hammon",
            place:"Oracle of Hammon, Libyan Africa",
            coord:[25.52,29.20],
            evidence:"ancient",
            route:null,
            recipes:["t"],
            cite:"Pliny, Naturalis historia 12.107; compare Dioscorides, De materia medica 1.59.1, 3.83–84",
            note:"Pliny says hammoniacum exudes in the sands of Africa near the oracle of Hammon from a tree called metopon. Dioscorides instead assigns metopon to the galbanum plant and treats ammoniacum separately. This is a competing ancient etymological and provenance claim—not a Metopion ingredient. The point conventionally anchors the oracle at Siwa; no supply route is inferred and no modern taxon is imposed."
          }
        ]
      }
    ];

    const theology = {
      id: "theology",
      greek: "Πουντ / tꜢ-nṯr",
      translit: "Punt / ta-netjer",
      gloss: "Punt / the Divine Land",
      recipes: ["m","t","s"],
      claims: [
        { id:"divine-land", place:"Punt / tꜢ-nṯr — theological register", coord:[42.0,9.2], evidence:"theology", route:null, recipes:["m","t","s"], cite:"Edfu II 204–208; Athribis F6 ‘Punt hall’; Wilde et al., ZÄS 152.1 (2025), 117–135", note:"‘Things of the Land of god’ and bodily origins of aromatics express sacred value and divine association. The halo is intentionally not a literal pin for a modern territory." }
      ]
    };

    const allIngredients = ingredients.concat(contextIngredients,[theology]);
    const ingredientGroups = [
      { id:"bases", label:"Base oils and carriers", ids:["balanos","almonds","omphacine","oil"] },
      { id:"resins", label:"Resins and plant exudates", ids:["myrrh","resin","balsam","galbanum","gum"] },
      { id:"spices", label:"Spices and aromatic grasses", ids:["cassia","cinnamon","cardamom","schoinos","kalamos"] },
      { id:"flowers", label:"Flowers, colourants, and substitutes", ids:["lily","saffron","karpesion","arnabo"] },
      { id:"workshop", label:"Workshop and processing materials", ids:["honey","wine","water","salt"] },
      { id:"context", label:"Comparative and theological context", ids:["hammoniacum-metopon","theology"] }
    ];
    const ingredientGroupShortLabels = {
      bases:"Base oils",
      resins:"Resins",
      spices:"Spices & grasses",
      flowers:"Flowers & colour",
      workshop:"Workshop",
      context:"Context"
    };
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
      { text:"Athens", coord:[23.7,37.9], dx:6, dy:-6 },
      { text:"Jericho", coord:[35.44,31.87], dx:6, dy:-5 },
      { text:"Petra", coord:[35.44,30.33], dx:6, dy:13 },
      { text:"Gaza", coord:[34.47,31.5], dx:-26, dy:-6 },
      { text:"Coptos", coord:[32.8,26.0], dx:6, dy:-6 },
      { text:"Myos Hormos", coord:[33.6,27.2], dx:7, dy:-5 },
      { text:"Berenice", coord:[35.5,23.9], dx:7, dy:12 }
    ];

    const routes = [
      { id:"india-sea", type:"sea", coords:[[72.5,19.0],[61.0,15.5],[49.2,12.7],[43.3,12.6],[39.5,17.0],[35.5,23.9]], label:"INDIA → RED SEA · SEA / CONVENTIONAL", labelAt:[55.0,11.6] },
      { id:"red-sea", type:"sea", coords:[[43.3,12.6],[40.0,16.0],[37.7,20.0],[35.5,23.9],[33.6,27.2]], label:"RED SEA PORTS · SEA / CONVENTIONAL", labelAt:[41.0,18.6] },
      { id:"berenice-coptos", type:"land", coords:[[35.5,23.9],[34.2,25.0],[32.8,26.0]], label:"BERENICE → COPTOS · LAND", labelAt:[35.0,24.6] },
      { id:"myos-coptos", type:"land", coords:[[33.6,27.2],[32.8,26.0]], label:"MYOS HORMOS → COPTOS · LAND", labelAt:[33.8,27.0] },
      { id:"nile", type:"river", coords:[[32.8,26.0],[31.7,28.4],[31.2,30.1],[31.5,30.95]], label:"NILE · CONVENTIONAL", labelAt:[29.4,28.7] },
      { id:"incense-road", type:"land", coords:[[44.2,15.4],[39.7,21.4],[37.4,26.6],[35.44,30.33],[34.47,31.5],[31.5,30.95]], label:"PETRA → GAZA · LAND / CONVENTIONAL", labelAt:[42.0,27.2] },
      { id:"med-sea", type:"sea", coords:[[14.0,37.5],[23.7,37.9],[30.0,36.2],[33.3,35.0],[29.9,31.2],[31.5,30.95]], label:"MEDITERRANEAN · SEA / CONVENTIONAL", labelAt:[17.5,35.0] },
      { id:"syria-land", type:"land", coords:[[36.3,36.6],[36.3,33.5],[34.47,31.5],[31.5,30.95]], label:"SYRIA · LAND / CONVENTIONAL", labelAt:[38.0,33.6] }
    ];

    const convergence = {
      med: [[29.9,31.2],[31.5,30.95]],
      incense: [[35.44,30.33],[34.47,31.5],[31.5,30.95]],
      redsea: [[35.5,23.9],[32.8,26.0],[31.5,30.95]],
      nile: [[32.8,26.0],[31.5,30.95]],
      syria: [[36.3,33.5],[34.47,31.5],[31.5,30.95]],
      india: [[43.3,12.6],[35.5,23.9],[32.8,26.0],[31.5,30.95]]
    };
