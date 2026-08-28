// Copy the logic from semanticRag.ts since functions are not exported
function cleanChunkContent(raw: string): string {
  let cleaned = raw.replace(/^(?:•\s*)*(?:About Us|Vision and Mission|Founder's Desk|Affliated university|Accreditation|Recognition|Annual Reports|Organisation Chart|NEC Nellore \| Narayana Engineering College|HOME|\s+)+/gi, '').trim();
  cleaned = cleaned.replace(/(?:•\s*){3,}/g, ' ');
  return cleaned || raw;
}

function extractBodyContent(raw: string): string {
  const cleaned = cleanChunkContent(raw);
  if (cleaned.length <= 800) return cleaned.slice(0, 500).trim();

  // Look for content sections, not just nav end markers
  // Priority: find ##H1## headings that indicate actual content sections
  const contentSectionMarkers = ['##H1## Facilities', '##H1## Facilities\n', 'Facilities\n', '##H1## Contact Us'];
  let bodyStart = -1;
  
  for (const marker of contentSectionMarkers) {
    const idx = cleaned.indexOf(marker);
    if (idx >= 0) { 
      bodyStart = idx; 
      break; 
    }
  }

  // Fallback to nav end markers if no content section found
  if (bodyStart < 0) {
    const navEndMarkers = ['• Stakeholders\n', 'Stakeholders\n##H1##', '• Stakeholders\n##H1##'];
    for (const marker of navEndMarkers) {
      const idx = cleaned.indexOf(marker);
      if (idx >= 0) { bodyStart = idx + marker.length; break; }
    }
  }

  // Final fallback: use the last ##H1## in the first 60% of content
  if (bodyStart < 0) {
    const cutoff = Math.floor(cleaned.length * 0.6);
    let last = -1;
    let pos = 0;
    while (pos < cutoff) {
      const found = cleaned.indexOf('##H1##', pos);
      if (found < 0 || found >= cutoff) break;
      last = found;
      pos = found + 6;
    }
    if (last >= 0) bodyStart = last;
  }

  if (bodyStart > 0 && bodyStart < cleaned.length - 100) {
    // Extract more content to capture detailed sections (up to 2000 chars)
    return cleaned.slice(bodyStart, bodyStart + 2000).trim();
  }
  return cleaned.slice(0, 500).trim();
}

// Test the body extraction on the facilities chunk
const facilitiesChunk = `About Us
• About us
• Vision and Mission
• Founder's Desk
• Affliated university
• Accreditation
• Recognition
• Annual Reports
• Organisation Chart
• Route Map

Administration
• Principal
• Director
• Sponsoring Body
• Administration
• Governing Body
• Internal Complaint
##H1## Committee
• Academic Leadership
• Executive Council

Academics
• Details of Academic Programs

Academic Calendar
• Autonomous
Academic
Calendars
• University
Academic
Calendars

Academic Regulations
• Autonomous
• University

##H1## Syllabus
• Autonomous
• University

Committees
• Academic
Council
• governing-body
• Board of
Studies
• Library
• Downloads
• Results
• Contact Us

Admission & Fee
• Prospectus
• Admission Procedure
• Fee Refund Policy
• College Fees
• Contact Us

##H1## Departments

UG
• CIVIL
• CSE
• CSE-AIML
• CSE-AI
• CSE-AIDS
• ECE
• ECE-VLSI
• ECE-ACT
• EEE
• MECH
• FED

PG
• MBA
• MCA

Campus Life
• Hobby Clubs
• BIS-STANDARD-CLUB
• TECHNICAL-CLUB
• HVPE
• Sports
• Sports
• Yoga
• Achievements
• Extension
Activites
• NSS Activites
• NCC Activites
• Outreach Programs
• Department Association
• Counseling
• Career
• Personal
• Academic
• Co-Curricular
Activities
• Central Library
• Infrastructure / Facilities
• Placements
• Career Development
Programs
• Industrial
##H1## Collaboration
• Training
• Career Guidance
Cell
• Placement Records
• Placement Contact
• Photo Gallery
• Research
• R & D office
• Research
Activities
• In-house Projects
• Sponsored Projects
• Papers Published
• Research Policy
• Code of Ethics
• AICTE IDEA LAB
• Research Contact
• Student Life
• Anti Ragging Cell
• Equal Opportunity Cell
• Internal Complaint Committee
• Grievance Redressal Committee
(Institution Level)
• Socio-Economically Disadavantage Group cell (SEDG)
• Facilities For Differently-abled
• Womens Grievance Redressal
• Alumni
• Alumni Office
• Alumni Holdings Good Positions
• Alumni Photo Gallery
• Registration
• Alumni Contact
• AUTONOMOUS
• IQAC
• More...
• IPR
• Stakeholders

About Us
• Institute History
• Founder
• Vision and Mission
• Organisation Chart
• Route Map

Administration
• Director
• Principal
• Administration
• Governing Body
• Academic Leadership

Academics

Academic Calendar
• Autonomous
Academic
Calendars
• University
Academic
Calendars

Academic Regulations
• Autonomous
• University

##H1## Syllabus
• Autonomous
• University

Committees
• Academic Council
• governing-body
• Board of Studies
• Downloads
• Results
• Contact Us

Admission & Fee
• Details of Academic Programs
• Details of Students
Admitted
• Admission Procedure
• College Fees
• Fee Refund Policy
• Contact Us

##H1## Departments
• CIVIL
• CSE
• CSE-AIML
• CSE-AI
• CSE-AIDS
• ECE
• ECE-VLSI
• ECE-ACT
• EEE
• MECH
• FED
• MBA
• MCA

Campus Life
• Hobby Clubs
• BIS-STANDARD-CLUB
• TECHNICAL-CLUB
• HVPE
• Sports
• Sports
• Yoga
• Achievements
• Extension
Activites
• NSS Activites
• NCC Activites
• Outreach Programs
• Department Association
• Counseling
• Career
• Personal
• Academic
• Co-Curricular
Activities
• Central Library
• Infrastructure / Facilities
• Placements
• Career Development
Programs
• Industrial
##H1## Collaboration
• Training
• Career Guidance Cell
• Placement Records
• Placement Contact
• Photo Gallery
• Research
• R & D office
• Research
Activities
• In-house Projects
• Sponsored Projects
• Papers Published
• Research Policy
• Code of Ethics
• AICTE IDEA LAB
• Research Contact
• Student Life
• Anti Ragging Cell
• Equal Opportunity Cell
• Internal Complaint Committee
• Grievance Redressal Committee (Institution
Level)
• Socio-Economically Disadavantage Group cell (SEDG)
• Facilities For Differently-abled
• Womens Grievance Redressal
• Alumni
• Alumni Office
• Alumni Holdings Good Positions
• Alumni Photo Gallery
• Registration
• Alumni Contact
• AUTONOMOUS
• IQAC
• More...
• IPR
• Stakeholders
"Credentials" * Permanently affiliated to JNTUA, Anatapuramu * Recognized by UGC U/S 2(f)&12(B)
* ISO 9001:2008 Certified Institution * Attained 'A' Grade by Govt. of Andhra Pradesh
##H1## Facilities
Canteen
College has a beautiful canteen which can accomodate 400
students, with seperate dining facility for Boys and Girl
Students. Canteen has in house kitchen to cater the needs of
students.
Wi-Fi Campus
Campus is having 1 Gbps of high speed
internet facility. The institute has a 24X7 Wi-Fi facility
in the college campus for the student and faculty members to
avail internet connection at any place in the college,
Canteen & Libarary.
Auditorium
Our Campus has a fully Air-conditioned
Auditorium that can accomodate over 500 members with full
fledged audio and video equipment
Gym
A central multi-facility piece of equipment for the men
and women enables several enthusiasts to work out at
flexible times in the gymnasium. Qualified gym instructor is
available round-the-clock to train students specifically for
their respective sports. This gym has separate timings for
men and women.
Gym Timings
For Girls: 6:00AM to 7:30AM
For Boys: 5:00PM to 6:30PM
Central Library
Narayana Engineering College houses a centralized and
advanced library among department-exclusive ones for
references and research throughout print and online media.
With an area of about 650 sq.m seating about 300 students at
a time, it houses over 40,000 books and subscribes to over
100 national and 15 international journals including the
prestigious Institute of Electrical and Electronics
Engineers Journal (IEEE) and the International Journal of
Information and Communication Technology. The information
centre grows by leaps and bounds with our students
contributing back volumes of journals and project reports
every year.
All activities and update feeds within the library are
computerized with advanced in-built software and bar-coding
system supervising circulation of material and determining
user status and library search systems. The digital wing of
the library caters to its growing necessity in today's
engineering, well equipped with 40 systems of digital medium
references through Synchronous Optical Networking (SONET),
Developing Library Network (DELNET) and NPTEL educational
and lecture based CDs.
Audiovisual theatre for better projection of technical
channels and seminar rooms for project-based discussions are
designed separately to enhance the quality-intensive
approach in learning experiences.
ICT Enabled Tools for Teaching & Learning
The institution promotes the extensive use of ICT-enabled tools
and online resources to enhance the teaching-learning process.
Classrooms, seminar halls, labs, and auditoriums are equipped
with ICT facilities such as LCD projectors, computers with
internet access, and smart boards. Faculty members leverage
these tools to adopt innovative teaching methods that improve
learning outcomes.
Faculty use a range of ICT resources including working models,
charts, PowerPoint presentations (PPTs), videos, and animations
to explain complex concepts. Additionally, they upload lecture
notes, PPTs, assignments, and tutorials to the Learning
Management System (LMS), ensuring that students have easy access
to learning materials. The institution subscribes to online
resources like IEEE, Digital Library, and DELNET, providing both
faculty and students with access to the latest academic
research.
1. Learning Management Systems (LMS):
• Moodle
2. Simulation and Virtual Lab Platforms
• Multisim
• ANSYS
• MATLAB Simulink
• SolidWorks Simulation
• STAAD
• ETABS
• GeoStudio
• Cisco Packet Tracer
• Wireshark
• PSIM
• PSS/E
• Arduino IDE with Simulators.. etc
3. Coding and Programming Platforms:
• HackerRank
• CodeTantra
• CodeChef
• Jupyter Notebook
4. Presentation and Interactive Tools:
• PowerPoint with multimedia integration
• Mentimeter (for polls and quizzes)
5. E-Books and Digital Libraries:
• Library
6. Video Conferencing and Virtual Teaching
Platforms:
• Zoom
• Google Meet
7. Digital Whiteboards:
• Jamboard
• OpenBoard
8. Assessment Tools:
• Quizizz
• Google Forms
9. Collaborative Tools:
• Google Docs and Sheets
Sports Complex
E-Class Room
Transport / Parking
Green Audit Campus
Building Photos
Fire Safety
Potable Water Supply
Grid Connected Solar System
Backup Electric Supply
Disable-Friendly & Barrier Free Environment
Dispensary
Media Cell
Rain Water Harvesting
Notice Boards
##H1## Contact Us
Success! we will get back to you soon...
Sorry! Something went wrong Please try again later
Please fill all the Fields
Contact Form
Submit
##H1## Quick Links
• NIRF
• AICTE Mandatory Disclosure
• RTI

Organogram
• Strategic Plan
• Careers

AICTE Feedback
• Online

• Approvals
Resources
• NAAC
• HR Policies
• College
Video
• Code
of Conduct
• Core
Values
• Cells &
Committees
• Innovation Cell
• MOUs

Moodle Server
• Reach Us
Locate Us
&copy; Narayana Engineering College - All Rights
Reserved.
• Sitemap
• Contact
• Facebook
• YouTube
• Instagram
• WhatsApp
• LinkedIn`;

console.log('=== TEST BODY EXTRACTION ===\n');
console.log('Original length:', facilitiesChunk.length);

const extracted = extractBodyContent(facilitiesChunk);
console.log('Extracted length:', extracted.length);
console.log('Extracted preview (first 500 chars):');
console.log(extracted.slice(0, 500));
console.log('\nTerm search in extracted:');
console.log('  "canteen":', extracted.toLowerCase().includes('canteen') ? 'FOUND' : 'NOT FOUND');
console.log('  "hostel":', extracted.toLowerCase().includes('hostel') ? 'FOUND' : 'NOT FOUND');
console.log('  "infrastructure":', extracted.toLowerCase().includes('infrastructure') ? 'FOUND' : 'NOT FOUND');
console.log('  "facility":', extracted.toLowerCase().includes('facility') ? 'FOUND' : 'NOT FOUND');
console.log('  "facilities":', extracted.toLowerCase().includes('facilities') ? 'FOUND' : 'NOT FOUND');
