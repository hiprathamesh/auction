import json, re, hashlib
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
text = (ROOT / 'data/auction_players_list.txt').read_text(encoding='utf-8')
headers = {'Marquee Set 1','Set 1','Set 2','Set 3','Set 4','BA1','AL1','WK1','FA1','SP1','UBA1','UAL1','UWK1','UFA1','USP1','BA2','AL2','WK2','FA2','SP2','UBA2'}
players=[]; group=''
for line in text.splitlines():
    s=line.strip()
    if not s: continue
    if s in headers: group=s
    else: players.append({'name':s,'set':group,'legend':False})

# Roles are inferred from the player's usual T20/auction role. This is game metadata, not an official classification.
BAT='Batter'; BOWL='Bowler'; AR='All-rounder'; WK='Wicketkeeper'
role_lists = {
 BAT: '''Aiden Markram Ishan Kishan Phil Salt Rinku Singh Rishabh Pant Ruturaj Gaikwad Shimron Hetmyer Shivam Dube Shubman Gill Suryakumar Yadav Tim David Travis Head Virat Kohli Will Jacks Abhishek Sharma Dhruv Jurel Glenn Phillips Rajat Patidar Riyan Parag Sai Sudharsan Sherfane Rutherford Tilak Varma Tristan Stubbs Dewald Brevis Jacob Bethell Matthew Breetzke Nitish Rana Ryan Rickelton Ajinkya Rahane Devdutt Padikkal Karun Nair Manish Pandey Shahrukh Khan Abdul Samad Abhishek Porel Angkrish Raghuvanshi Ashutosh Sharma Ayush Badoni Ayush Mhatre Donovan Ferreira Harnoor Pannu Himmat Singh Nehal Wadhera Prabhsimran Singh Priyansh Arya Sameer Rizvi Shashank Singh Shubham Dubey Smaran Ravichandaran Urvil Patel Vaibhav Suryavanshi Virat Kohli Cameron Green David Miller Devon Conway Jake Fraser-McGurk Prithvi Shaw Sarfaraz Khan Aarya Desai Abhinav Manohar Abhinav Tejrana Anmolpreet Singh Atharva Taide Yash Dhull Ackeem Auguste Mayank Agarawal Pathum Nissanka Rahul Tripathi Reeza Hendricks Sediqullah Atal Steve Smith Tim Robinson Akshat Raghuwanshi Aman Rao Perala Ankit Kumar Danish Malewar Manan Vohra Pukhraj Mann Rohan Kunnummal Salman Nizar'''.split(),
 AR: '''Hardik Pandya Marco Jansen Marcus Stoinis Mitchell Marsh Ravindra Jadeja Sam Curran Sunil Narine Azmatullah Omarzai Krunal Pandya Romario Shepherd Rovman Powell Washington Sundar Corbin Bosch Kamindu Mendis Mitchell Owen Rahul Tewatia Nitish Kumar Reddy Shahbaz Ahmed Anukul Roy Ajay Mandal Arshin Kulkarni Aniket Verma Harpreet Brar Harsh Dubey Musheer Khan Naman Dhir Nishant Sindhu Raj Angad Bawa Ramakrishna Ghosh Ramandeep Singh Suryansh Shedge Swapnil Singh Yudhvir Charak Deepak Hooda Gus Atkinson Liam Livingstone Rachin Ravindra Venkatesh Iyer Wanindu Hasaranga Wiaan Mulder Auqib Dar Edhen Tom Kamlesh Nagarkoti Mahipal Lomror Prashant Veer Rajvardhan Hangargekar Sanvir Singh Shivang Kumar Tanush Kotian Vijay Shankar Ben Dwarshuis Daniel Sams Daryl Mitchell Dasun Shanaka Jason Holder Matthew Short Michael Bracewell Sean Abbott'''.split(),
 WK: '''Heinrich Klaasen Ishan Kishan MS Dhoni Phil Salt Rishabh Pant Jos Buttler Dhruv Jurel Jitesh Sharma Abhishek Porel Anuj Rawat Kumar Kushagra Prabhsimran Singh Robin Minz Vishnu Vinod Lhuan-Dre Pretorious Ben Duckett Finn Allen Jamie Smith Jonny Bairstow K.S. Bharat Quinton De Kock Rahmanullah Gurbaz Kartik Sharma Mukul Choudhary Ruchit Ahir Tejasvi Singh Tushar Raheja Vansh Bedi Benjamin McDermott Jordan Cox Josh Inglis Kusal Mendis Kusal Perera Shai Hope Tim Seifert Tom Banton'''.split(),
 BOWL: '''Arshdeep Singh Bhuvneshwar Kumar Jofra Archer Josh Hazlewood Kagiso Rabada Kuldeep Yadav Lockie Ferguson Mitchell Starc Mohammad Shami Mohammad Siraj Noor Ahmad Pat Cummins Rashid Khan Trent Boult Varun Chakravarthy Yuzvendra Chahal Avesh Khan Deepak Chahar Harshal Patel Khaleel Ahmed Mayank Yadav Mitchell Santner Prasidh Krishna Shardul Thakur T. Natarajan Allah Ghazanfar Brydon Carse Dushmantha Chameera Jamie Overton Jaydev Unadkat Mukesh Kumar Nandre Burger Nathan Ellis Nuwan Thushara Xavier Bartlett Harshit Rana Ishant Sharma Jayant Yadav R. Sai Kishore Sandeep Sharma Tushar Deshpande Umran Malik Yash Dayal Abhinandan Singh Akash Singh Anshul Kamboj Ashwani Kumar Eshan Malinga Gurjapneet Singh Gurnoor Brar Kwena Maphaka M. Siddharth Manav Suthar Mayank Markande Mohd. Arshad Khan Mohsin Khan Mukesh Choudhary Prince Yadav Raghu Sharma Rasikh Salam Suyash Sharma Vaibhav Arora Vipraj Nigam Vyshak Vijaykumar Yash Thakur Zeeshan Ansari Akash Deep Anrich Nortje Fazalhaq Farooqi Gerald Coetzee Jacob Duffy Matheesha Pathirana Matt Henry Shivam Mavi Spencer Johnson Akeal Hosein Maheesh Theekshana Mujeeb Rahman Rahul Chahar Ravi Bishnoi Akash Madhwal Ashok Sharma Kartik Tyagi Naman Tiwari Raj Limbani Simarjeet Singh Sushant Mishra Karn Sharma Kumar Kartikeya Singh Prashant Solanki Shivam Shukla Vignesh Puthur Wahidullah Zadran Yash Raj Punja Adam Milne Chetan Sakariya Kuldeep Sen Kyle Jamieson Lungisani Ngidi Mustafizur Rahman Saqib Mahmood Umesh Yadav William Orourke Mohammad Waqar Salamkheil Qais Ahmad Rishad Hossain Viyaskanth Vijayakanth'''.split()
}
# The role lists are compact strings to keep this script readable; parse them against the exact
# player names in the supplied pool so multi-word names remain intact.
known_source_names = sorted((p['name'] for p in players), key=lambda n: len(n.split()), reverse=True)
role_by_name = {}
for role, raw_names in role_lists.items():
    tokens = raw_names
    # Rejoin full names by greedily matching the longest known name at the current token position.
    i = 0
    while i < len(tokens):
        match = next((name for name in known_source_names if tokens[i:i + len(name.split())] == name.split()), None)
        if match:
            role_by_name[match] = role
            i += len(match.split())
        else:
            i += 1
# Prioritized country list; names not listed are treated as Indian for this auction database.
# A few hybrid roles are deliberately overridden to reflect their usual auction function.
role_overrides = {
    'Axar Patel': AR, 'Abhishek Sharma': AR, 'Cameron Green': AR, 'Will Jacks': AR,
    'Riyan Parag': AR, 'Glenn Phillips': AR, 'Devon Conway': WK, 'Ryan Rickelton': WK,
    'Rahul Tewatia': AR, 'Nitish Rana': BAT, 'Shivam Dube': AR, 'Deepak Hooda': AR,
    'Prithvi Shaw': BAT, 'Ben Duckett': WK, 'Shai Hope': WK,
    'Jasprit Bumrah': BOWL, 'KL Rahul': WK, 'Nicholas Pooran': WK,
    'Rohit Sharma': BAT, 'Sanju Samson': WK, 'Shreyas Iyer': BAT,
    'Yashasvi Jaiswal': BAT,
}
# Hand-tuned skill ratings for these added marquee players. OVR is still computed
# using the role-weighted formula below, not a simple average of the three skills.
skill_overrides = {
    'Jasprit Bumrah': (55, 99, 95),
    'KL Rahul': (97, 40, 96),
    'Nicholas Pooran': (99, 35, 95),
    'Rohit Sharma': (99, 58, 91),
    'Sanju Samson': (97, 40, 95),
    'Shreyas Iyer': (98, 50, 90),
    'Yashasvi Jaiswal': (99, 55, 90),
    'MS Dhoni': (92, 40, 94),
    'Trent Boult': (60, 96, 92),
    'Bhuvneshwar Kumar': (65, 97, 94),
}
overseas_tokens = '''Aiden Markram Heinrich Klaasen Jofra Archer Jos Buttler Josh Hazlewood Kagiso Rabada Lockie Ferguson Marco Jansen Marcus Stoinis Mitchell Marsh Mitchell Starc Noor Ahmad Pat Cummins Phil Salt Rashid Khan Sam Curran Shimron Hetmyer Sunil Narine Tim David Travis Head Trent Boult Will Jacks Azmatullah Omarzai Glenn Phillips Mitchell Santner Romario Shepherd Rovman Powell Sherfane Rutherford Tristan Stubbs Allah Ghazanfar Brydon Carse Corbin Bosch Dewald Brevis Dushmantha Chameera Jacob Bethell Jamie Overton Kamindu Mendis Matthew Breetzke Mitchell Owen Nandre Burger Nathan Ellis Nuwan Thushara Ryan Rickelton Xavier Bartlett Donovan Ferreira Eshan Malinga Kwena Maphaka Lhuan-Dre Pretorious Cameron Green David Miller Devon Conway Jake Fraser-McGurk Gus Atkinson Liam Livingstone Rachin Ravindra Wanindu Hasaranga Wiaan Mulder Ben Duckett Finn Allen Jamie Smith Jonny Bairstow Quinton De Kock Rahmanullah Gurbaz Anrich Nortje Fazalhaq Farooqi Gerald Coetzee Jacob Duffy Matheesha Pathirana Matt Henry Spencer Johnson Akeal Hosein Maheesh Theekshana Mujeeb Rahman Wahidullah Zadran Ackeem Auguste Pathum Nissanka Reeza Hendricks Sediqullah Atal Steve Smith Tim Robinson Ben Dwarshuis Daniel Sams Daryl Mitchell Dasun Shanaka Jason Holder Matthew Short Michael Bracewell Sean Abbott Benjamin McDermott Jordan Cox Josh Inglis Kusal Mendis Kusal Perera Shai Hope Tim Seifert Tom Banton Adam Milne Kyle Jamieson Lungisani Ngidi Mustafizur Rahman Saqib Mahmood William Orourke Mohammad Waqar Salamkheil Qais Ahmad Rishad Hossain Viyaskanth Vijayakanth Nicholas Pooran'''.split()
overseas = set()
i = 0
while i < len(overseas_tokens):
    match = next((name for name in known_source_names if overseas_tokens[i:i + len(name.split())] == name.split()), None)
    if match:
        overseas.add(match)
        i += len(match.split())
    else:
        i += 1
# Highest-impact well-known names receive deliberate game ratings. Values are handcrafted approximations for this game.
star = {
 'Virat Kohli':95,'Suryakumar Yadav':95,'Jasprit Bumrah':96,'Rashid Khan':94,'Hardik Pandya':93,'Heinrich Klaasen':94,'Jos Buttler':94,'Pat Cummins':92,'Ravindra Jadeja':93,'Rishabh Pant':92,'Shubman Gill':92,'Travis Head':94,'Sunil Narine':94,'Jofra Archer':91,'Mitchell Starc':92,'Jasprit Bumrah':96,'MS Dhoni':87,'Rinku Singh':89,'Ruturaj Gaikwad':91,'Kuldeep Yadav':91,'Yuzvendra Chahal':91,'Arshdeep Singh':89,'Axar Patel':90,'Mohammad Shami':90,'Mohammad Siraj':88,'Bhuvneshwar Kumar':87,'Rashid Khan':94,'Kagiso Rabada':91,'Josh Hazlewood':91,'Mitchell Marsh':90,'Marcus Stoinis':89,'Sam Curran':89,'Marco Jansen':88,'Phil Salt':91,'Lockie Ferguson':87,'Varun Chakravarthy':90,'Noor Ahmad':88,'Shivam Dube':88,'Will Jacks':89,'Aiden Markram':87,'Jadeja':93,'Ishan Kishan':89,'Ravindra Jadeja':93,
 'Abhishek Sharma':91,'Sai Sudharsan':88,'Tilak Varma':89,'Rajat Patidar':87,'Riyan Parag':87,'Glenn Phillips':87,'Mitchell Santner':86,'Krunal Pandya':86,'Washington Sundar':85,'Mayank Yadav':87,'Tristan Stubbs':88,'Dewald Brevis':86,'Nitish Kumar Reddy':85,'Ryan Rickelton':86,
 'Cameron Green':90,'David Miller':89,'Devon Conway':88,'Jake Fraser-McGurk':86,'Liam Livingstone':89,'Rachin Ravindra':88,'Wanindu Hasaranga':90,'Venkatesh Iyer':86,'Quinton De Kock':90,'Finn Allen':87,'Jonny Bairstow':87,'Matheesha Pathirana':90,'Anrich Nortje':87,'Mustafizur Rahman':86,
}
legends = [
    ('AB de Villiers', 'Marquee Set 1', 'Wicketkeeper', 'Overseas', 99, 99, 50, 99),
    ('Adam Gilchrist', 'Marquee Set 1', 'Wicketkeeper', 'Overseas', 97, 99, 50, 95),
    ('Brendon McCullum', 'Marquee Set 1', 'Wicketkeeper', 'Overseas', 96, 98, 50, 95),
    ('Chris Gayle', 'Marquee Set 1', 'Batter', 'Overseas', 99, 99, 55, 93),
    ('Dwayne Bravo', 'Marquee Set 1', 'All-rounder', 'Overseas', 96, 96, 99, 94),
    ('Kieron Pollard', 'Marquee Set 1', 'All-rounder', 'Overseas', 98, 96, 96, 94),
    ('Lasith Malinga', 'Marquee Set 1', 'Bowler', 'Overseas', 99, 60, 99, 92),
    ('Shane Warne', 'Marquee Set 1', 'Bowler', 'Overseas', 99, 70, 99, 94),
    ('Shane Watson', 'Marquee Set 1', 'All-rounder', 'Overseas', 97, 98, 96, 94),
    ('Suresh Raina', 'Marquee Set 1', 'Batter', 'Indian', 95, 97, 55, 96),
    ('Virender Sehwag', 'Marquee Set 1', 'Batter', 'Indian', 97, 99, 55, 93),
    ('Yuvraj Singh', 'Marquee Set 1', 'All-rounder', 'Indian', 97, 96, 96, 95),
    ('Ambati Rayudu', 'Marquee Set 1', 'Batter', 'Indian', 95, 97, 55, 93),
    ('Anil Kumble', 'Marquee Set 1', 'Bowler', 'Indian', 95, 60, 97, 92),
    ('Dale Steyn', 'Marquee Set 1', 'Bowler', 'Overseas', 97, 60, 99, 93),
    ('Gautam Gambhir', 'Marquee Set 1', 'Batter', 'Indian', 95, 97, 55, 93),
    ('Harbhajan Singh', 'Marquee Set 1', 'Bowler', 'Indian', 95, 70, 97, 92),
    ('Herschelle Gibbs', 'Marquee Set 1', 'Batter', 'Overseas', 95, 97, 55, 93),
    ('Jacques Kallis', 'Marquee Set 1', 'All-rounder', 'Overseas', 98, 99, 97, 94),
    ('Kevin Pietersen', 'Marquee Set 1', 'Batter', 'Overseas', 95, 98, 55, 93),
    ('Matthew Hayden', 'Marquee Set 1', 'Batter', 'Overseas', 96, 99, 55, 93),
    ('Robin Uthappa', 'Marquee Set 1', 'Wicketkeeper', 'Indian', 95, 97, 50, 95),
    ('Yusuf Pathan', 'Marquee Set 1', 'All-rounder', 'Indian', 96, 96, 96, 94),
    ('Zaheer Khan', 'Marquee Set 1', 'Bowler', 'Indian', 95, 60, 98, 92),
    ('Andrew Symonds', 'Marquee Set 1', 'All-rounder', 'Overseas', 97, 97, 96, 94),
    ('Daniel Vettori', 'Marquee Set 1', 'Bowler', 'Overseas', 95, 65, 97, 95),
    ('Imran Tahir', 'Marquee Set 1', 'Bowler', 'Overseas', 95, 60, 99, 92),
    ('JP Duminy', 'Marquee Set 1', 'All-rounder', 'Overseas', 96, 96, 96, 94),
    ('Kumar Sangakkara', 'Marquee Set 1', 'Wicketkeeper', 'Overseas', 97, 99, 50, 96),
    ('Mahela Jayawardene', 'Marquee Set 1', 'Batter', 'Overseas', 96, 97, 55, 94),
    ('Morne Morkel', 'Marquee Set 1', 'Bowler', 'Overseas', 95, 60, 97, 92),
    ('Munaf Patel', 'Marquee Set 1', 'Bowler', 'Indian', 95, 60, 97, 92),
    ('Praveen Kumar', 'Marquee Set 1', 'Bowler', 'Indian', 95, 60, 97, 92),
    ('Ross Taylor', 'Marquee Set 1', 'Batter', 'Overseas', 95, 97, 55, 93),
    ('RP Singh', 'Marquee Set 1', 'Bowler', 'Indian', 95, 60, 97, 92),
    ('Shaun Marsh', 'Marquee Set 1', 'Batter', 'Overseas', 95, 97, 55, 93),
    ('Sachin Tendulkar', 'Marquee Set 1', 'Batter', 'Indian', 99, 99, 60, 98),
    ('Rahul Dravid', 'Marquee Set 1', 'Batter', 'Indian', 97, 97, 55, 99),
    ('Shikhar Dhawan', 'Marquee Set 1', 'Batter', 'Indian', 95, 98, 55, 95),
    ('Dinesh Karthik', 'Marquee Set 1', 'Wicketkeeper', 'Indian', 95, 97, 50, 96),
    ('Irfan Pathan', 'Marquee Set 1', 'All-rounder', 'Indian', 96, 96, 99, 94),
    ('Murali Vijay', 'Marquee Set 1', 'Batter', 'Indian', 95, 97, 55, 93),
    ('S. Badrinath', 'Marquee Set 1', 'Batter', 'Indian', 95, 97, 55, 93),
    ('Pragyan Ojha', 'Marquee Set 1', 'Bowler', 'Indian', 95, 60, 97, 92),
    ('Ashish Nehra', 'Marquee Set 1', 'Bowler', 'Indian', 95, 60, 97, 92),
    ('Brett Lee', 'Marquee Set 1', 'Bowler', 'Overseas', 95, 65, 97, 92),
    ('David Warner', 'Marquee Set 1', 'Batter', 'Overseas', 98, 99, 58, 94),
    ('Kane Williamson', 'Marquee Set 1', 'Batter', 'Overseas', 96, 98, 56, 96),
    ('Amit Mishra', 'Marquee Set 1', 'Bowler', 'Indian', 95, 58, 98, 92),
    ('Michael Hussey', 'Marquee Set 1', 'Batter', 'Overseas', 96, 98, 55, 95),
    ('Faf du Plessis', 'Marquee Set 1', 'Batter', 'Overseas', 97, 98, 55, 96),
    ('Muttiah Muralitharan', 'Marquee Set 1', 'Bowler', 'Overseas', 99, 58, 99, 93),
]
for name, st, role, nationality, ovr, bat, bowl, field in legends:
    players.append({'name':name,'set':st,'legend':True,'role':role,'nationality':nationality,'ovr':ovr,'batting':bat,'bowling':bowl,'fielding':field})

# Preferred T20 batting positions. These are game-design defaults based on players'
# established IPL/T20 usage, not immutable real-world positions. Edit the arrays in
# data/players.json to customize any player. Adjacent slots deliberately allow flexibility.
preferred_position_overrides = {
    # Active marquee batters and wicketkeepers
    'Aiden Markram': [1, 2, 3], 'Heinrich Klaasen': [3, 4, 5], 'Ishan Kishan': [1, 2, 3],
    'Jos Buttler': [1, 2, 3], 'MS Dhoni': [5, 6, 7], 'Phil Salt': [1, 2, 3],
    'Rinku Singh': [5, 6, 7], 'Rishabh Pant': [3, 4, 5], 'Ruturaj Gaikwad': [1, 2, 3],
    'Shimron Hetmyer': [5, 6, 7], 'Shivam Dube': [4, 5, 6], 'Shubman Gill': [1, 2, 3],
    'Sunil Narine': [1, 2, 3, 4], 'Suryakumar Yadav': [3, 4, 5], 'Tim David': [5, 6, 7],
    'Travis Head': [1, 2, 3], 'Virat Kohli': [1, 2, 3], 'Will Jacks': [1, 2, 3],
    'Hardik Pandya': [4, 5, 6], 'Ravindra Jadeja': [5, 6, 7], 'Sam Curran': [5, 6, 7],
    'Marcus Stoinis': [4, 5, 6], 'Mitchell Marsh': [1, 2, 3], 'Marco Jansen': [6, 7, 8],
    'Axar Patel': [6, 7, 8], 'Jasprit Bumrah': [], 'KL Rahul': [1, 2, 3],
    'Nicholas Pooran': [3, 4, 5], 'Rohit Sharma': [1, 2, 3], 'Sanju Samson': [1, 2, 3],
    'Shreyas Iyer': [3, 4, 5], 'Yashasvi Jaiswal': [1, 2, 3],
    # Recently promoted from BA1 / AL1 / WK1
    'Cameron Green': [3, 4, 5], 'David Miller': [5, 6, 7], 'Devon Conway': [1, 2, 3],
    'Jake Fraser-McGurk': [1, 2, 3], 'Prithvi Shaw': [1, 2, 3], 'Sarfaraz Khan': [3, 4, 5],
    'Deepak Hooda': [4, 5, 6], 'Gus Atkinson': [8, 9, 10], 'Liam Livingstone': [4, 5, 6],
    'Rachin Ravindra': [1, 2, 3], 'Venkatesh Iyer': [3, 4, 5], 'Wanindu Hasaranga': [6, 7, 8],
    'Wiaan Mulder': [6, 7, 8], 'Ben Duckett': [1, 2, 3], 'Finn Allen': [1, 2, 3],
    'Jamie Smith': [1, 2, 3], 'Jonny Bairstow': [1, 2, 3], 'K.S. Bharat': [5, 6, 7],
    'Quinton De Kock': [1, 2, 3], 'Rahmanullah Gurbaz': [1, 2, 3],
    # Existing legends
    'AB de Villiers': [3, 4, 5], 'Adam Gilchrist': [1, 2], 'Brendon McCullum': [1, 2, 3],
    'Chris Gayle': [1, 2], 'Dwayne Bravo': [6, 7, 8], 'Kieron Pollard': [5, 6, 7],
    'Shane Watson': [1, 2, 3], 'Suresh Raina': [3, 4, 5], 'Virender Sehwag': [1, 2],
    'Yuvraj Singh': [4, 5, 6], 'Ambati Rayudu': [3, 4, 5], 'Gautam Gambhir': [1, 2],
    'Herschelle Gibbs': [1, 2, 3], 'Jacques Kallis': [1, 2, 3], 'Kevin Pietersen': [3, 4, 5],
    'Matthew Hayden': [1, 2], 'Robin Uthappa': [1, 2, 3], 'Yusuf Pathan': [5, 6, 7],
    'Andrew Symonds': [4, 5, 6], 'JP Duminy': [3, 4, 5], 'Kumar Sangakkara': [1, 2, 3],
    'Mahela Jayawardene': [1, 2, 3], 'Ross Taylor': [4, 5, 6], 'Shaun Marsh': [1, 2, 3],
    'Sachin Tendulkar': [1, 2], 'Rahul Dravid': [3, 4, 5], 'Shikhar Dhawan': [1, 2],
    'Dinesh Karthik': [5, 6, 7], 'Irfan Pathan': [6, 7, 8], 'Murali Vijay': [1, 2],
    'S. Badrinath': [4, 5, 6],
    # Newly added legends
    'David Warner': [1, 2], 'Kane Williamson': [3, 4, 5], 'Michael Hussey': [1, 2, 3],
    'Faf du Plessis': [1, 2],
}

def default_preferred_positions(name, role, auction_set):
    if role == BOWL:
        return []
    if name in preferred_position_overrides:
        return preferred_position_overrides[name]
    if role == AR:
        return [5, 6, 7]
    if role == WK:
        if auction_set.startswith(('WK', 'UWK')):
            return [3, 4, 5]
        return [3, 4, 5]
    if auction_set.startswith(('BA', 'UBA')):
        return [1, 2, 3]
    if auction_set.startswith(('AL', 'UAL')):
        return [5, 6, 7]
    if auction_set in ('Marquee Set 1', 'Set 1'):
        return [2, 3, 4]
    return [3, 4, 5]

# Primary franchise used for the optional Right To Match feature. These are
# curated defaults, not exclusive career histories. The user can edit each
# player's `rtmTeamId` directly in data/players.json; the generator preserves it.
# Use only current franchise IDs. Legacy franchises map to their successor where
# the connection is clear (e.g. Deccan Chargers -> SRH, Delhi Daredevils -> DC,
# Kings XI Punjab -> PBKS). Unknown/uncertain players intentionally remain null.
rtm_team_overrides = {
    # Current / recent marquee players
    'Aiden Markram': 'SRH', 'Arshdeep Singh': 'PBKS', 'Axar Patel': 'DC',
    'Bhuvneshwar Kumar': 'SRH', 'Cameron Green': 'MI', 'David Miller': 'GT',
    'Deepak Hooda': 'LSG', 'Devon Conway': 'CSK', 'Finn Allen': 'RCB',
    'Hardik Pandya': 'MI', 'Heinrich Klaasen': 'SRH', 'Ishan Kishan': 'MI',
    'Jake Fraser-McGurk': 'DC', 'Jasprit Bumrah': 'MI', 'Jofra Archer': 'RR',
    'Jonny Bairstow': 'PBKS', 'Jos Buttler': 'RR', 'Josh Hazlewood': 'RCB',
    'K.S. Bharat': 'RCB', 'Kagiso Rabada': 'PBKS', 'KL Rahul': 'PBKS',
    'Kuldeep Yadav': 'DC', 'Liam Livingstone': 'PBKS', 'Lockie Ferguson': 'KKR',
    'Marco Jansen': 'SRH', 'Marcus Stoinis': 'LSG', 'Mitchell Marsh': 'DC',
    'Mitchell Starc': 'KKR', 'Mohammad Shami': 'GT', 'Mohammad Siraj': 'RCB',
    'MS Dhoni': 'CSK', 'Nicholas Pooran': 'LSG', 'Noor Ahmad': 'CSK',
    'Pat Cummins': 'SRH', 'Phil Salt': 'RCB', 'Prithvi Shaw': 'DC',
    'Quinton De Kock': 'MI', 'Rachin Ravindra': 'CSK', 'Rahmanullah Gurbaz': 'KKR',
    'Rashid Khan': 'GT', 'Ravindra Jadeja': 'CSK', 'Rinku Singh': 'KKR',
    'Rishabh Pant': 'DC', 'Rohit Sharma': 'MI', 'Ruturaj Gaikwad': 'CSK',
    'Sam Curran': 'PBKS', 'Sanju Samson': 'RR', 'Sarfaraz Khan': 'CSK',
    'Shimron Hetmyer': 'RR', 'Shivam Dube': 'CSK', 'Shreyas Iyer': 'KKR',
    'Shubman Gill': 'GT', 'Sunil Narine': 'KKR', 'Suryakumar Yadav': 'MI',
    'Tim David': 'MI', 'Travis Head': 'SRH', 'Trent Boult': 'MI',
    'Varun Chakravarthy': 'KKR', 'Venkatesh Iyer': 'KKR', 'Virat Kohli': 'RCB',
    'Wanindu Hasaranga': 'RCB', 'Will Jacks': 'RCB', 'Yashasvi Jaiswal': 'RR',
    'Yuzvendra Chahal': 'RCB',
    # Other established active players with a clear primary franchise
    'Abhishek Sharma': 'SRH', 'Avesh Khan': 'LSG', 'Azmatullah Omarzai': 'GT',
    'Deepak Chahar': 'CSK', 'Dhruv Jurel': 'RR', 'Glenn Phillips': 'SRH',
    'Harshal Patel': 'PBKS', 'Khaleel Ahmed': 'DC', 'Krunal Pandya': 'MI',
    'Mayank Yadav': 'LSG', 'Mitchell Santner': 'CSK', 'Prasidh Krishna': 'GT',
    'Rajat Patidar': 'RCB', 'Riyan Parag': 'RR', 'Romario Shepherd': 'RCB',
    'Rovman Powell': 'KKR', 'Sai Sudharsan': 'GT', 'Shardul Thakur': 'CSK',
    'Sherfane Rutherford': 'GT', 'T. Natarajan': 'SRH', 'Tilak Varma': 'MI',
    'Tristan Stubbs': 'DC', 'Washington Sundar': 'SRH',
    'Dewald Brevis': 'MI', 'Dushmantha Chameera': 'LSG', 'Jacob Bethell': 'RCB',
    'Jamie Overton': 'CSK', 'Jaydev Unadkat': 'SRH', 'Kamindu Mendis': 'SRH',
    'Mitchell Owen': 'PBKS', 'Mukesh Kumar': 'DC', 'Nandre Burger': 'RR',
    'Nathan Ellis': 'PBKS', 'Nitish Rana': 'KKR', 'Nuwan Thushara': 'MI',
    'Rahul Tewatia': 'GT', 'Ryan Rickelton': 'MI', 'Xavier Bartlett': 'PBKS',
    'Ajinkya Rahane': 'CSK', 'Devdutt Padikkal': 'RCB', 'Harshit Rana': 'KKR',
    'Ishant Sharma': 'DC', 'Jayant Yadav': 'GT', 'Jitesh Sharma': 'PBKS',
    'Karun Nair': 'RR', 'Manish Pandey': 'KKR', 'Nitish Kumar Reddy': 'SRH',
    'R. Sai Kishore': 'GT', 'Sandeep Sharma': 'RR', 'Shahbaz Ahmed': 'SRH',
    'Shahrukh Khan': 'PBKS', 'Tushar Deshpande': 'CSK', 'Umran Malik': 'SRH',
    'Yash Dayal': 'RCB', 'Abdul Samad': 'SRH', 'Abhishek Porel': 'DC',
    'Anukul Roy': 'KKR', 'Arjun Tendulkar': 'MI', 'Ashutosh Sharma': 'PBKS',
    'Ayush Badoni': 'LSG', 'Ayush Mhatre': 'CSK', 'Digvesh Rathi': 'LSG',
    'Donovan Ferreira': 'RR', 'Eshan Malinga': 'SRH', 'Harpreet Brar': 'PBKS',
    'Harsh Dubey': 'SRH', 'Kumar Kushagra': 'DC', 'Kwena Maphaka': 'MI',
    'Lhuan-Dre Pretorious': 'RR', 'M. Siddharth': 'LSG', 'Mayank Markande': 'MI',
    'Mohd. Arshad Khan': 'GT', 'Mohsin Khan': 'LSG', 'Mukesh Choudhary': 'CSK',
    'Musheer Khan': 'PBKS', 'Naman Dhir': 'MI', 'Nehal Wadhera': 'PBKS',
    'Prabhsimran Singh': 'PBKS', 'Priyansh Arya': 'PBKS', 'Ramandeep Singh': 'KKR',
    'Rasikh Salam': 'DC', 'Robin Minz': 'MI', 'Sameer Rizvi': 'DC',
    'Shashank Singh': 'PBKS', 'Shreyas Gopal': 'RR', 'Suyash Sharma': 'KKR',
    'Swapnil Singh': 'RCB', 'Urvil Patel': 'GT', 'Vaibhav Arora': 'KKR',
    'Vaibhav Suryavanshi': 'RR', 'Vipraj Nigam': 'DC', 'Vishnu Vinod': 'MI',
    'Vyshak Vijaykumar': 'RCB', 'Yash Thakur': 'LSG', 'Yudhvir Charak': 'LSG',
    'Akash Deep': 'RCB', 'Anrich Nortje': 'DC', 'Fazalhaq Farooqi': 'SRH',
    'Gerald Coetzee': 'MI', 'Matheesha Pathirana': 'CSK', 'Shivam Mavi': 'KKR',
    'Akeal Hosein': 'SRH', 'Maheesh Theekshana': 'CSK', 'Mujeeb Rahman': 'PBKS',
    'Rahul Chahar': 'PBKS', 'Ravi Bishnoi': 'PBKS', 'Anmolpreet Singh': 'PBKS',
    'Atharva Taide': 'PBKS', 'Yash Dhull': 'DC', 'Mahipal Lomror': 'LSG',
    'Rajvardhan Hangargekar': 'CSK', 'Sanvir Singh': 'SRH', 'Tanush Kotian': 'RR',
    'Vijay Shankar': 'GT', 'Karn Sharma': 'RCB', 'Manan Vohra': 'RR',
    'Mayank Agarawal': 'SRH', 'Rahul Tripathi': 'SRH', 'Steve Smith': 'RR',
    'Daniel Sams': 'MI', 'Daryl Mitchell': 'CSK', 'Dasun Shanaka': 'GT',
    'Jason Holder': 'LSG', 'Matthew Short': 'PBKS', 'Michael Bracewell': 'RCB',
    'Sean Abbott': 'SRH', 'Josh Inglis': 'PBKS', 'Shai Hope': 'DC',
    'Adam Milne': 'MI', 'Chetan Sakariya': 'DC', 'Kuldeep Sen': 'RR',
    'Kyle Jamieson': 'RCB', 'Lungisani Ngidi': 'CSK', 'Mustafizur Rahman': 'CSK',
    'Umesh Yadav': 'KKR', 'Kumar Kartikeya Singh': 'MI',
    # Legends: choose the most strongly associated current franchise/successor.
    'AB de Villiers': 'RCB', 'Adam Gilchrist': 'SRH', 'Ambati Rayudu': 'CSK',
    'Amit Mishra': 'DC', 'Andrew Symonds': 'SRH', 'Anil Kumble': 'RCB',
    'Ashish Nehra': 'SRH', 'Brendon McCullum': 'KKR', 'Brett Lee': 'KKR',
    'Chris Gayle': 'RCB', 'Dale Steyn': 'RCB', 'Daniel Vettori': 'RCB',
    'David Warner': 'SRH', 'Dinesh Karthik': 'KKR', 'Dwayne Bravo': 'CSK',
    'Faf du Plessis': 'CSK', 'Gautam Gambhir': 'KKR', 'Harbhajan Singh': 'MI',
    'Herschelle Gibbs': 'SRH', 'Imran Tahir': 'CSK', 'Irfan Pathan': 'PBKS',
    'Allah Ghazanfar': 'MI', 'Corbin Bosch': 'MI', 'Brydon Carse': 'SRH',
    'Abhinandan Singh': 'RCB', 'Akash Singh': 'CSK', 'Angkrish Raghuvanshi': 'KKR',
    'Aniket Verma': 'SRH', 'Anshul Kamboj': 'CSK', 'Anuj Rawat': 'RCB',
    'Arshin Kulkarni': 'LSG', 'Ashwani Kumar': 'MI', 'Gurnoor Brar': 'PBKS',
    'Himmat Singh': 'DC', 'Manav Suthar': 'GT', 'Nishant Sindhu': 'CSK',
    'Prince Yadav': 'LSG', 'Pyla Avinash': 'SRH', 'Raj Angad Bawa': 'PBKS',
    'Ramakrishna Ghosh': 'CSK', 'Shubham Dubey': 'RR', 'Smaran Ravichandaran': 'RCB',
    'Suryansh Shedge': 'PBKS', 'Tripurana Vijay': 'SRH', 'Zeeshan Ansari': 'SRH',
    'Jacob Duffy': 'RCB', 'Spencer Johnson': 'GT', 'Abhinav Manohar': 'GT',
    'Kamlesh Nagarkoti': 'KKR', 'Prashant Veer': 'CSK', 'Shivang Kumar': 'SRH',
    'Kartik Sharma': 'CSK', 'Mukul Choudhary': 'LSG', 'Tushar Raheja': 'CSK',
    'Vansh Bedi': 'CSK', 'Akash Madhwal': 'MI', 'Ashok Sharma': 'RR',
    'Kartik Tyagi': 'SRH', 'Raj Limbani': 'GT', 'Simarjeet Singh': 'CSK',
    'Sushant Mishra': 'SRH', 'Prashant Solanki': 'CSK', 'Vignesh Puthur': 'MI',
    'Pathum Nissanka': 'RR', 'Ben Dwarshuis': 'PBKS', 'Tom Banton': 'KKR',
    'Jacques Kallis': 'KKR', 'JP Duminy': 'DC', 'Kane Williamson': 'SRH',
    'Kevin Pietersen': 'DC', 'Kieron Pollard': 'MI', 'Kumar Sangakkara': 'SRH',
    'Lasith Malinga': 'MI', 'Mahela Jayawardene': 'MI', 'Matthew Hayden': 'CSK',
    'Michael Hussey': 'CSK', 'Morne Morkel': 'KKR', 'Munaf Patel': 'MI',
    'Murali Vijay': 'CSK', 'Muttiah Muralitharan': 'SRH', 'Pragyan Ojha': 'SRH',
    'Praveen Kumar': 'PBKS', 'Rahul Dravid': 'RR', 'Robin Uthappa': 'KKR',
    'Ross Taylor': 'DC', 'RP Singh': 'SRH', 'S. Badrinath': 'CSK',
    'Sachin Tendulkar': 'MI', 'Shane Warne': 'RR', 'Shane Watson': 'CSK',
    'Shaun Marsh': 'PBKS', 'Shikhar Dhawan': 'PBKS', 'Suresh Raina': 'CSK',
    'Virender Sehwag': 'DC', 'Yusuf Pathan': 'KKR', 'Yuvraj Singh': 'PBKS',
    'Zaheer Khan': 'MI',
    # Additional franchise associations verified from IPL profiles / squad records.
    'Ajay Mandal': 'CSK', 'Danish Malewar': 'MI', 'Gurjapneet Singh': 'CSK',
    'Harnoor Pannu': 'PBKS', 'Kusal Perera': 'RR', 'Madhav Tiwari': 'DC',
    'Matt Henry': 'CSK', 'Matthew Breetzke': 'LSG', 'Raghu Sharma': 'MI',
    'Sediqullah Atal': 'DC', 'Tim Seifert': 'KKR', 'Wiaan Mulder': 'SRH',
    'Gus Atkinson': 'KKR', 'Ben Duckett': 'DC', 'Jordan Cox': 'RCB',
    'Kusal Mendis': 'GT', 'Viyaskanth Vijayakanth': 'SRH',
}
VALID_RTM_TEAM_IDS = {'CSK', 'MI', 'RCB', 'KKR', 'SRH', 'RR', 'DC', 'PBKS', 'GT', 'LSG'}

# Preserve locally imported portrait metadata when regenerating ratings/database records.
try:
    _existing = json.loads((ROOT / 'data/players.json').read_text(encoding='utf-8')).get('players', [])
except (OSError, ValueError, AttributeError):
    _existing = []
_existing_by_id = {p.get('id'): p for p in _existing if p.get('id')}
_existing_by_name = {p.get('name', '').casefold(): p for p in _existing if p.get('name')}

# First occurrence wins if the source ever contains a duplicate.
seen=set(); output=[]
set_order=[]
for line in text.splitlines():
    s=line.strip()
    if s in headers and s not in set_order: set_order.append(s)
for p in players:
    key=p['name'].lower()
    if key in seen: continue
    seen.add(key)
    name=p['name']; st=p['set']; legend=p['legend']
    if 'role' in p:
        role=p['role']
        nationality=p['nationality']
        ovr=p['ovr']; batting=p['batting']; bowling=p['bowling']; fielding=p['fielding']
    else:
        role=role_overrides.get(name, role_by_name.get(name))
        # Auction category gives a strong prior for the later, role-sorted sets.
        if not role:
            prefix=st[:3]
            if st.startswith('BA'): role=BAT
            elif st.startswith('AL'): role=AR
            elif st.startswith('WK'): role=WK
            elif st.startswith('FA') or st.startswith('UFA') or st.startswith('SP') or st.startswith('USP'): role=BOWL
            elif st.startswith('UBA'): role=BAT
            elif st.startswith('UAL'): role=AR
            elif st.startswith('UWK'): role=WK
            else:
                # Conservative heuristic fallback for the mixed first four groups.
                low=name.lower()
                if any(x in low for x in ['singh','sharma','patel','kumar','yadav','chahar','rathi','markande','bishnoi','deshpande','arora','malinga','burger','ellis','thushara','hazlewood','boult','rabada','archer','cummins','starc','chahal','kuldeep','farooqi','coetzee','madhwal','tang','mavi','natarajan','krishna']): role=BOWL
                else: role=BAT
        nationality='Overseas' if name in overseas else 'Indian'
        # Broad set-dependent priors make the long tail credible without pretending ratings are official.
        set_floor = {'Marquee Set 1':79,'Set 1':70,'Set 2':67,'Set 3':64,'Set 4':59}.get(st, 65 if st.startswith(('BA','AL','WK','FA','SP')) else 57)
        seed=int(hashlib.md5((name+st).encode()).hexdigest()[:8],16)
        # Slight deterministic variety; avoid randomness when rebuilding the database.
        variance=(seed%13)-6
        ovr=max(54,min(92,set_floor+variance))
        if name in star: ovr=max(ovr,star[name])
        if st.startswith('U'): ovr=min(ovr,79)
        if role==BAT:
            batting=min(99,ovr+8); bowling=max(25,ovr-38); fielding=max(42,ovr-4)
        elif role==WK:
            batting=min(99,ovr+6); bowling=max(20,ovr-48); fielding=min(99,ovr+4)
        elif role==BOWL:
            bowling=min(99,ovr+7); batting=max(25,ovr-28); fielding=max(40,ovr-5)
        else:
            batting=min(98,ovr+3); bowling=min(98,ovr+2); fielding=max(45,ovr-2)
        # Hand-tuned skill scores for the added marquee players, while retaining
        # the same role-based OVR formula used by the rest of the active pool.
        if name in skill_overrides:
            batting, bowling, fielding = skill_overrides[name]
        # A simple role-weighted OVR model: key skill matters most; fielding is secondary.
        if role==BAT: ovr=round(.80*batting+.13*fielding+.07*bowling)
        elif role==WK: ovr=round(.76*batting+.20*fielding+.04*bowling)
        elif role==BOWL: ovr=round(.80*bowling+.11*fielding+.09*batting)
        else: ovr=round(.44*batting+.44*bowling+.12*fielding)
    # Map rating to auction base price (Cr); all prices are INR crore.
    if ovr>=91: base=2.0
    elif ovr>=86: base=1.5
    elif ovr>=80: base=1.0
    elif ovr>=73: base=0.75
    elif ovr>=66: base=0.5
    elif ovr>=60: base=0.3
    else: base=0.2
    if legend: base=max(base,1.0 if ovr<90 else 2.0)
    slug=re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')
    # Add stable suffix only if necessary.
    pid=slug
    if any(q['id']==pid for q in output): pid += '-' + hashlib.md5(name.encode()).hexdigest()[:4]
    preferred_positions = default_preferred_positions(name, role, st)
    output.append({'id':pid,'name':name,'set':st,'role':role,'nationality':nationality,'overseas':nationality=='Overseas','legend':legend,'ovr':int(ovr),'batting':int(batting),'bowling':int(bowling),'fielding':int(fielding),'basePrice':base,'preferredBattingPositions':preferred_positions,'rtmTeamId':rtm_team_overrides.get(name)})
    old = _existing_by_id.get(pid) or _existing_by_name.get(name.casefold()) or {}
    # Preserve user-managed values when rebuilding: manual ratings, preferred slots and portraits.
    for key in ('ovr', 'batting', 'bowling', 'fielding', 'basePrice'):
        value = old.get(key)
        if isinstance(value, (int, float)):
            valid_value = value > 0 if key == 'basePrice' else 1 <= value <= 99
            if valid_value:
                output[-1][key] = value
    if isinstance(old.get('preferredBattingPositions'), list):
        if role == BOWL:
            output[-1]['preferredBattingPositions'] = []
        else:
            valid = sorted({int(pos) for pos in old['preferredBattingPositions'] if str(pos).isdigit() and 1 <= int(pos) <= 11})
            # An explicitly empty list is a valid manual choice (no preferred-slot bonus).
            output[-1]['preferredBattingPositions'] = valid
    for key in ('photo', 'photoAttribution'):
        if key in old:
            output[-1][key] = old[key]
    if 'rtmTeamId' in old:
        old_rtm = old.get('rtmTeamId')
        if old_rtm in VALID_RTM_TEAM_IDS:
            output[-1]['rtmTeamId'] = old_rtm
        else:
            # Explicit null (or an empty/invalid value) is a persistent no-RTM choice.
            # Remove this key from the old record to re-apply the curated default mapping.
            output[-1]['rtmTeamId'] = None
# Preserve set ordering based on the user's file and append legend set names as already present.
output.sort(key=lambda p:(set_order.index(p['set']) if p['set'] in set_order else 999, p['legend'], p['name'].lower()))
(ROOT/'data/players.json').write_text(json.dumps({'schemaVersion':1,'source':'auction_players_list.txt','ratingNote':'Game-balance estimates, not official or predictive statistics.','setOrder':set_order,'players':output},ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Wrote {len(output)} players across {len(set_order)} source sets; legends={sum(p["legend"] for p in output)}')
unmapped_rtm = sorted(p['name'] for p in output if not p.get('rtmTeamId'))
(ROOT/'data/rtm_unmapped_players.txt').write_text('\n'.join(unmapped_rtm) + ('\n' if unmapped_rtm else ''), encoding='utf-8')
print(f'RTM franchise defaults assigned: {len(output) - len(unmapped_rtm)}/{len(output)}; unmapped list: data/rtm_unmapped_players.txt')
from collections import Counter
print(Counter(p['set'] for p in output))
