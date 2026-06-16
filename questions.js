/* ============================================================
   TierBrain — shared question repository
   ------------------------------------------------------------
   This file is NOT a page. It is a data library loaded by the
   games via:  <script src="questions.js?v=1"></script>
   Bump the ?v= number whenever you update this file so phones
   fetch the fresh copy instead of a cached one.

   Structure:  TB_BANK[category][tier] = [ {q, correct, wrong:[3]}, ... ]
     - category : "gk" (general knowledge), plus topic banks later
     - tier     : "1" easiest  ->  "4" hardest (matches game levels)

   Use in a game:   var BANK = TB.bank('gk');   // {1:[...],2:[...],3:[...],4:[...]}
   then keep the game's existing question-picking logic.

   CONTENT RULES (keep the bank trustworthy):
     - timeless, verifiable facts only; no current office-holders,
       "latest/biggest", or live records that go stale
     - no disputed answers unless the question is qualified
     - 3 wrong options that are clearly wrong but plausible
   ============================================================ */
(function(){
  var TB_BANK = {
    gk: {
      "1": [
        {q:"What is the capital of France?", correct:"Paris", wrong:["Lyon","Marseille","Nice"]},
        {q:"How many legs does a spider have?", correct:"Eight", wrong:["Six","Ten","Four"]},
        {q:"What colour do you get by mixing blue and yellow?", correct:"Green", wrong:["Purple","Orange","Brown"]},
        {q:"Which planet do we live on?", correct:"Earth", wrong:["Mars","Venus","Jupiter"]},
        {q:"How many days are there in a week?", correct:"Seven", wrong:["Five","Six","Eight"]},
        {q:"What is H2O more commonly known as?", correct:"Water", wrong:["Salt","Oxygen","Vinegar"]},
        {q:"What is the largest land animal?", correct:"African elephant", wrong:["Hippopotamus","Giraffe","Rhinoceros"]},
        {q:"How many sides does a triangle have?", correct:"Three", wrong:["Four","Five","Two"]},
        {q:"What is the opposite of 'hot'?", correct:"Cold", wrong:["Warm","Dry","Wet"]},
        {q:"Which animal is often called 'man's best friend'?", correct:"Dog", wrong:["Cat","Horse","Rabbit"]},
        {q:"What gas do humans breathe in to survive?", correct:"Oxygen", wrong:["Carbon dioxide","Helium","Hydrogen"]},
        {q:"What is frozen water called?", correct:"Ice", wrong:["Steam","Mist","Fog"]},
        {q:"How many colours are traditionally said to be in a rainbow?", correct:"Seven", wrong:["Five","Six","Nine"]},
        {q:"What is the name of the star at the centre of our solar system?", correct:"The Sun", wrong:["The Moon","Polaris","Mars"]},
        {q:"Which is the tallest living animal in the world?", correct:"Giraffe", wrong:["Elephant","Horse","Camel"]},
        {q:"What do caterpillars turn into?", correct:"Butterflies", wrong:["Spiders","Bees","Beetles"]},
        {q:"What is the first letter of the English alphabet?", correct:"A", wrong:["Z","B","E"]},
        {q:"How many hours are there in a day?", correct:"24", wrong:["12","36","48"]},
        {q:"What colour is a ripe banana?", correct:"Yellow", wrong:["Blue","Purple","Red"]},
        {q:"Which season comes after winter?", correct:"Spring", wrong:["Summer","Autumn","Monsoon"]},
        {q:"What is the capital of England?", correct:"London", wrong:["Manchester","Birmingham","Liverpool"]},
        {q:"How many wheels does a standard bicycle have?", correct:"Two", wrong:["Three","Four","One"]},
        {q:"What do cows produce that people drink?", correct:"Milk", wrong:["Juice","Honey","Cider"]},
        {q:"Which of these is a fruit?", correct:"Apple", wrong:["Carrot","Potato","Onion"]},
        {q:"What is the colour of the sky on a clear day?", correct:"Blue", wrong:["Green","Pink","Grey"]}
      ],
      "2": [
        {q:"What is the capital of Australia?", correct:"Canberra", wrong:["Sydney","Melbourne","Perth"]},
        {q:"Who wrote the play 'Romeo and Juliet'?", correct:"William Shakespeare", wrong:["Charles Dickens","Jane Austen","Mark Twain"]},
        {q:"What is the chemical symbol for gold?", correct:"Au", wrong:["Gd","Go","Ag"]},
        {q:"How many players from one team are on the pitch in football (soccer)?", correct:"Eleven", wrong:["Ten","Nine","Twelve"]},
        {q:"What is the largest planet in our solar system?", correct:"Jupiter", wrong:["Saturn","Neptune","Earth"]},
        {q:"Which is the largest ocean on Earth?", correct:"Pacific", wrong:["Atlantic","Indian","Arctic"]},
        {q:"What currency is used in Japan?", correct:"Yen", wrong:["Won","Yuan","Ringgit"]},
        {q:"Who painted the Mona Lisa?", correct:"Leonardo da Vinci", wrong:["Michelangelo","Raphael","Donatello"]},
        {q:"What is the hardest known natural substance?", correct:"Diamond", wrong:["Granite","Iron","Quartz"]},
        {q:"How many continents are there on Earth?", correct:"Seven", wrong:["Five","Six","Eight"]},
        {q:"What is the chemical symbol for iron?", correct:"Fe", wrong:["Ir","In","Fr"]},
        {q:"Which gas makes up most of Earth's atmosphere?", correct:"Nitrogen", wrong:["Oxygen","Carbon dioxide","Hydrogen"]},
        {q:"In which country is the Eiffel Tower?", correct:"France", wrong:["Italy","Spain","Belgium"]},
        {q:"What is the smallest prime number?", correct:"2", wrong:["1","3","0"]},
        {q:"Who is the author of the 'Harry Potter' book series?", correct:"J.K. Rowling", wrong:["Roald Dahl","C.S. Lewis","Philip Pullman"]},
        {q:"What is the capital of Canada?", correct:"Ottawa", wrong:["Toronto","Vancouver","Montreal"]},
        {q:"How many strings does a standard guitar have?", correct:"Six", wrong:["Four","Five","Seven"]},
        {q:"What is the freezing point of water in degrees Celsius?", correct:"0", wrong:["32","100","-10"]},
        {q:"Which planet is known as the Red Planet?", correct:"Mars", wrong:["Venus","Mercury","Jupiter"]},
        {q:"What is the official language of Brazil?", correct:"Portuguese", wrong:["Spanish","Brazilian","French"]},
        {q:"Who developed the theory of general relativity?", correct:"Albert Einstein", wrong:["Isaac Newton","Galileo Galilei","Niels Bohr"]},
        {q:"What is the largest mammal in the world?", correct:"Blue whale", wrong:["African elephant","Giraffe","Orca"]},
        {q:"In which sport would you perform a 'slam dunk'?", correct:"Basketball", wrong:["Volleyball","Tennis","Cricket"]},
        {q:"What is the capital of Spain?", correct:"Madrid", wrong:["Barcelona","Seville","Valencia"]},
        {q:"How many minutes are there in a full day?", correct:"1440", wrong:["1240","960","1800"]}
      ],
      "3": [
        {q:"What is the SI unit of electrical resistance?", correct:"Ohm", wrong:["Volt","Ampere","Watt"]},
        {q:"Who wrote the novel 'Crime and Punishment'?", correct:"Fyodor Dostoevsky", wrong:["Leo Tolstoy","Anton Chekhov","Ivan Turgenev"]},
        {q:"What is the capital of New Zealand?", correct:"Wellington", wrong:["Auckland","Christchurch","Hamilton"]},
        {q:"Which element has the atomic number 1?", correct:"Hydrogen", wrong:["Helium","Oxygen","Carbon"]},
        {q:"Who composed 'The Four Seasons'?", correct:"Antonio Vivaldi", wrong:["Johann Sebastian Bach","Wolfgang Amadeus Mozart","Ludwig van Beethoven"]},
        {q:"What is the world's largest hot desert?", correct:"Sahara", wrong:["Gobi","Kalahari","Arabian"]},
        {q:"In Greek mythology, who is the king of the gods?", correct:"Zeus", wrong:["Poseidon","Hades","Apollo"]},
        {q:"What is the chemical symbol for sodium?", correct:"Na", wrong:["So","Sd","S"]},
        {q:"Which artist famously cut off part of his own ear?", correct:"Vincent van Gogh", wrong:["Pablo Picasso","Claude Monet","Salvador Dali"]},
        {q:"Which organ in the human body produces insulin?", correct:"Pancreas", wrong:["Liver","Kidney","Spleen"]},
        {q:"Who was the first person to walk on the Moon?", correct:"Neil Armstrong", wrong:["Buzz Aldrin","Yuri Gagarin","Michael Collins"]},
        {q:"What is the capital of Egypt?", correct:"Cairo", wrong:["Alexandria","Giza","Luxor"]},
        {q:"In which Shakespeare play does the character Iago appear?", correct:"Othello", wrong:["Hamlet","Macbeth","King Lear"]},
        {q:"The speed of light in a vacuum is approximately how fast?", correct:"300,000 km/s", wrong:["150,000 km/s","30,000 km/s","3,000 km/s"]},
        {q:"Who composed the music for the ballet 'Swan Lake'?", correct:"Pyotr Ilyich Tchaikovsky", wrong:["Igor Stravinsky","Sergei Prokofiev","Claude Debussy"]},
        {q:"What is the largest internal organ in the human body?", correct:"Liver", wrong:["Stomach","Lungs","Brain"]},
        {q:"Which metal is liquid at room temperature?", correct:"Mercury", wrong:["Lead","Aluminium","Zinc"]},
        {q:"What is the capital of Norway?", correct:"Oslo", wrong:["Bergen","Stavanger","Trondheim"]},
        {q:"Who painted 'The Persistence of Memory', known for its melting clocks?", correct:"Salvador Dali", wrong:["Pablo Picasso","Joan Miro","Rene Magritte"]},
        {q:"What is the longest bone in the human body?", correct:"Femur", wrong:["Tibia","Humerus","Fibula"]},
        {q:"In which year did World War II end?", correct:"1945", wrong:["1944","1946","1939"]},
        {q:"What is the chemical symbol for potassium?", correct:"K", wrong:["P","Po","Pt"]},
        {q:"Which planet is closest to the Sun?", correct:"Mercury", wrong:["Venus","Earth","Mars"]},
        {q:"Who wrote the novels '1984' and 'Animal Farm'?", correct:"George Orwell", wrong:["Aldous Huxley","Ray Bradbury","H.G. Wells"]},
        {q:"What is the scientific study of weather called?", correct:"Meteorology", wrong:["Geology","Astrology","Ecology"]}
      ],
      "4": [
        {q:"Who proposed the uncertainty principle in quantum mechanics?", correct:"Werner Heisenberg", wrong:["Erwin Schrodinger","Max Planck","Paul Dirac"]},
        {q:"What is the capital of Bhutan?", correct:"Thimphu", wrong:["Kathmandu","Dhaka","Naypyidaw"]},
        {q:"Which Russian author wrote 'War and Peace'?", correct:"Leo Tolstoy", wrong:["Fyodor Dostoevsky","Boris Pasternak","Maxim Gorky"]},
        {q:"What is the chemical symbol for tungsten?", correct:"W", wrong:["Tu","Tn","Tg"]},
        {q:"In what year did the Berlin Wall fall?", correct:"1989", wrong:["1987","1991","1985"]},
        {q:"Who composed the opera 'The Marriage of Figaro'?", correct:"Wolfgang Amadeus Mozart", wrong:["Giuseppe Verdi","Richard Wagner","Giacomo Puccini"]},
        {q:"What is the smallest country in the world by area?", correct:"Vatican City", wrong:["Monaco","San Marino","Liechtenstein"]},
        {q:"Which scientist formulated the three laws of planetary motion?", correct:"Johannes Kepler", wrong:["Tycho Brahe","Galileo Galilei","Nicolaus Copernicus"]},
        {q:"Which mineral sits at the top (10) of the Mohs hardness scale?", correct:"Diamond", wrong:["Corundum","Topaz","Quartz"]},
        {q:"Who wrote the philosophical work 'Critique of Pure Reason'?", correct:"Immanuel Kant", wrong:["Friedrich Nietzsche","Georg Hegel","Arthur Schopenhauer"]},
        {q:"What is the capital of Mongolia?", correct:"Ulaanbaatar", wrong:["Astana","Bishkek","Tashkent"]},
        {q:"Which metal has the highest melting point?", correct:"Tungsten", wrong:["Iron","Platinum","Titanium"]},
        {q:"Who painted the ceiling of the Sistine Chapel?", correct:"Michelangelo", wrong:["Leonardo da Vinci","Raphael","Caravaggio"]},
        {q:"What is the longest river in South America?", correct:"Amazon", wrong:["Parana","Orinoco","Sao Francisco"]},
        {q:"Which mathematician is known for his 'Last Theorem'?", correct:"Pierre de Fermat", wrong:["Carl Gauss","Leonhard Euler","Blaise Pascal"]},
        {q:"What is the chemical symbol for lead?", correct:"Pb", wrong:["Ld","Le","Pl"]},
        {q:"Which Ancient Wonder stood in the harbour of Rhodes?", correct:"The Colossus of Rhodes", wrong:["The Hanging Gardens","The Lighthouse of Alexandria","The Temple of Artemis"]},
        {q:"Who wrote the epic poem 'The Divine Comedy'?", correct:"Dante Alighieri", wrong:["Petrarch","Giovanni Boccaccio","Virgil"]},
        {q:"What is the SI base unit of luminous intensity?", correct:"Candela", wrong:["Lumen","Lux","Watt"]},
        {q:"Which composer kept composing after becoming profoundly deaf?", correct:"Ludwig van Beethoven", wrong:["Franz Schubert","Johannes Brahms","Frederic Chopin"]},
        {q:"Which planet in our solar system rotates roughly on its side?", correct:"Uranus", wrong:["Neptune","Saturn","Venus"]},
        {q:"Who is credited with discovering penicillin?", correct:"Alexander Fleming", wrong:["Louis Pasteur","Joseph Lister","Robert Koch"]},
        {q:"What is the term for a word that reads the same forwards and backwards?", correct:"Palindrome", wrong:["Anagram","Homonym","Onomatopoeia"]},
        {q:"Which element is the most abundant in the Sun?", correct:"Hydrogen", wrong:["Helium","Oxygen","Carbon"]},
        {q:"In Greek mythology, who flew too close to the Sun on wax wings?", correct:"Icarus", wrong:["Daedalus","Perseus","Theseus"]}
      ]
    }
    /* more categories (science, history, geography, sport, music, film, ...) added in later batches */
  };

  // ---- helper ----
  var TB = {
    v: 1,
    bank: function(cat){ return TB_BANK[cat] || {}; },
    tiers: function(cat){ var b=TB_BANK[cat]||{}; return Object.keys(b); },
    count: function(cat){ var n=0, cats=cat?[cat]:Object.keys(TB_BANK);
      cats.forEach(function(c){ var b=TB_BANK[c]||{}; Object.keys(b).forEach(function(t){ n+=b[t].length; }); }); return n; },
    // optional convenience: a random question for a category+tier, avoiding ids in `seen`
    pick: function(cat, tier, seen){ var arr=(TB_BANK[cat]||{})[String(tier)]||[]; if(!arr.length) return null;
      seen=seen||{}; var ids=[]; for(var i=0;i<arr.length;i++){ if(!seen[cat+tier+':'+i]) ids.push(i); }
      if(!ids.length){ for(var j=0;j<arr.length;j++) ids.push(j); }
      var k=ids[Math.floor(Math.random()*ids.length)]; seen[cat+tier+':'+k]=1; return arr[k]; }
  };

  window.TB_BANK = TB_BANK;
  window.TB = TB;
})();
