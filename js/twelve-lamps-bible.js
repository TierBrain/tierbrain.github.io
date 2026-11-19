/* Ten Lamps: Bible question topic. Adds 'bible' to the Questions dropdown. Load after ruffled-topics.js.
   Rows are [question, correct answer, three wrong answers]. Tiers: 1 easiest to 4 hardest. */
(function(){'use strict';
const T={
1:[['How many days and nights did the rain fall in Noah\u2019s flood?','Forty','Seven','Twelve','One hundred'],
 ['Who was swallowed by a great fish?','Jonah','Job','Amos','Micah'],
 ['In which town was Jesus born?','Bethlehem','Nazareth','Jericho','Capernaum'],
 ['Who built the ark?','Noah','Enoch','Seth','Lamech'],
 ['What did David use to defeat Goliath?','A sling and a stone','A spear','A sword','A bow'],
 ['How many disciples did Jesus choose to be his closest followers?','Twelve','Seven','Ten','Seventy'],
 ['Who was thrown into the lions\u2019 den?','Daniel','Joseph','Samson','Elijah'],
 ['What did God create on the first day?','Light','Dry land','The animals','People']],
2:[['Which sea did Moses part?','The Red Sea','The Dead Sea','The Sea of Galilee','The Mediterranean'],
 ['Who was sold into slavery by his brothers?','Joseph','Benjamin','Esau','Reuben'],
 ['Which book comes first in the Bible?','Genesis','Exodus','Psalms','Matthew'],
 ['Who was the first king of Israel?','Saul','David','Solomon','Samuel'],
 ['What was Paul\u2019s name before his conversion?','Saul','Simon','Barnabas','Silas'],
 ['Who denied knowing Jesus three times?','Peter','Judas','Thomas','John'],
 ['On which mountain did Moses receive the Ten Commandments?','Sinai','Carmel','Zion','Ararat'],
 ['How many plagues struck Egypt?','Ten','Seven','Twelve','Forty']],
3:[['Which prophet challenged the prophets of Baal on Mount Carmel?','Elijah','Elisha','Isaiah','Jeremiah'],
 ['Who was cupbearer to the Persian king before he rebuilt Jerusalem\u2019s walls?','Nehemiah','Ezra','Daniel','Mordecai'],
 ['Which woman became queen of Persia and saved her people?','Esther','Ruth','Deborah','Naomi'],
 ['Which of the twelve apostles had been a tax collector?','Matthew','Andrew','Philip','Bartholomew'],
 ['How many books are in the New Testament?','Twenty-seven','Twenty-four','Thirty-nine','Sixty-six'],
 ['In which garden did Jesus pray before his arrest?','Gethsemane','Eden','Gilgal','Siloam'],
 ['Which king asked God for wisdom?','Solomon','David','Hezekiah','Josiah'],
 ['In which city did Paul meet Lydia, a seller of purple cloth?','Philippi','Corinth','Ephesus','Athens']],
4:[['Who was the mother of the prophet Samuel?','Hannah','Leah','Rebekah','Elizabeth'],
 ['Which woman judged Israel and went to battle with Barak?','Deborah','Jael','Miriam','Huldah'],
 ['Who was Abraham\u2019s nephew, who lived in Sodom?','Lot','Laban','Ishmael','Esau'],
 ['Which Roman governor sentenced Jesus to be crucified?','Pontius Pilate','Herod Antipas','Felix','Festus'],
 ['Which two people were taken up to heaven without dying?','Enoch and Elijah','Moses and Elijah','Enoch and Noah','Elijah and Elisha'],
 ['Which Gospel opens with a genealogy beginning at Abraham?','Matthew','Mark','Luke','John'],
 ['Who was the first Christian martyr?','Stephen','James','Barnabas','Timothy'],
 ['Which prophet saw a valley of dry bones?','Ezekiel','Isaiah','Daniel','Hosea']]
};
window.RF_TOPICS=Object.assign(window.RF_TOPICS||{},{bible:'The Bible'});
window.RF_BANK=window.RF_BANK||{};
window.RF_BANK.bible={};
Object.keys(T).forEach(t=>{window.RF_BANK.bible[t]=T[t].map(a=>({q:a[0],correct:a[1],wrong:a.slice(2)}));});
})();
