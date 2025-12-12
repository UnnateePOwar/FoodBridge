import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Firebase config: replace the placeholder values with your project's config
const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_PROJECT.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket: "REPLACE_WITH_YOUR_PROJECT.appspot.com",
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
  appId: "REPLACE_WITH_YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);

// In-memory cache to keep most of the UI synchronous
const CACHE = { requests: [], users: {}, session: null };

async function initData() {
  // Load requests collection
  try {
    const q = await getDocs(collection(firestore, 'requests'));
    CACHE.requests = q.docs.map(d => d.data()).sort((a,b)=> (b.created_date || '') > (a.created_date || '') ? 1 : -1);
  } catch (err) {
    console.warn('Could not load requests from Firestore:', err);
    CACHE.requests = [];
  }

  // Load users and session stored under meta docs
  try {
    const usersDoc = await getDoc(doc(firestore, 'meta', 'users'));
    CACHE.users = usersDoc.exists() ? usersDoc.data().value : {};
  } catch (err) {
    console.warn('Could not load users from Firestore:', err);
    CACHE.users = {};
  }

  try {
    const sessionDoc = await getDoc(doc(firestore, 'meta', 'session'));
    CACHE.session = sessionDoc.exists() ? sessionDoc.data().value : null;
  } catch (err) {
    console.warn('Could not load session from Firestore:', err);
    CACHE.session = null;
  }
}

// Data functions backed by Firestore (and CACHE for sync access)
const db = {
  getRequests: () => CACHE.requests,
  saveRequests: async (r) => {
    CACHE.requests = r;
    try {
      const ops = r.map(item => setDoc(doc(firestore, 'requests', String(item.id)), item));
      await Promise.all(ops);
    } catch (err) {
      console.warn('Failed to save requests to Firestore:', err);
    }
  },

  getUsers: () => CACHE.users,
  saveUsers: async (u) => {
    CACHE.users = u;
    try {
      await setDoc(doc(firestore, 'meta', 'users'), { value: u });
    } catch (err) {
      console.warn('Failed to save users to Firestore:', err);
    }
  },

  getSession: () => CACHE.session,
  saveSession: async (s) => {
    CACHE.session = s;
    try {
      await setDoc(doc(firestore, 'meta', 'session'), { value: s });
    } catch (err) {
      console.warn('Failed to save session to Firestore:', err);
    }
  },
  clearSession: async () => {
    CACHE.session = null;
    try {
      await deleteDoc(doc(firestore, 'meta', 'session'));
    } catch (err) {
      // ignore
    }
  }
};

// Note: initial seeding happens during async startup below.

// DOM elements
const root = document.getElementById('view');
const pageTitle = document.getElementById('pageTitle');
const userSummary = document.getElementById('userSummary');
const quickActions = document.getElementById('quickActions');

// Update UI
function updateUI() {
  const session = db.getSession();
  
  // User summary
  if (session) {
    userSummary.innerHTML = `<div><strong>${session.full_name}</strong><br><small>${session.user_type}</small></div>`;
  } else {
    userSummary.innerHTML = '<button class="button" onclick="location.hash=\'#profile\'">Sign In / Profile</button>';
  }
  
  // Quick actions
  quickActions.innerHTML = '';
  const actions = [
    { title: 'Request Food', show: !session || ['recipient', 'both'].includes(session.user_type), href: '#request' },
    { title: 'Help Others', show: !session || ['donor', 'both'].includes(session.user_type), href: '#browse' }
  ];
  
  actions.forEach(a => {
    if (a.show) {
      const el = document.createElement('div');
      el.className = 'action';
      el.innerHTML = `<div>➕</div><div><div>${a.title}</div><small>${a.href}</small></div>`;
      el.onclick = () => location.hash = a.href;
      quickActions.appendChild(el);
    }
  });
  
  if (session) {
    const el = document.createElement('div');
    el.className = 'action';
    el.innerHTML = `<div>👤</div><div><div>Signed in as</div><small>${session.full_name}</small></div>`;
    el.onclick = () => location.hash = '#profile';
    quickActions.appendChild(el);
  } else {
    const el = document.createElement('div');
    el.className = 'signin';
    el.textContent = 'Sign In / Register';
    el.onclick = () => location.hash = '#profile';
    quickActions.appendChild(el);
  }
}

// Routing
const routes = {
  home: renderHome,
  request: renderRequestForm,
  browse: renderBrowse,
  profile: renderProfile
};

window.addEventListener('hashchange', () => {
  const hash = location.hash.replace('#', '') || 'home';
  if (routes[hash]) routes[hash]();
});

// Home page
function renderHome() {
  pageTitle.textContent = 'Community Map';
  root.innerHTML = `
    <div class="card"><h3>Welcome to Food Bridge</h3><p>Connecting donors with families in need.</p></div>
    <div class="card"><h3>Stats Overview</h3><div id="stats"></div></div>
    <div class="card"><h3>Local Area Map</h3><div id="map" class="fade-in"></div></div>
  `;
  
  // Stats
  const requests = db.getRequests();
  const statsEl = document.getElementById('stats');
  statsEl.innerHTML = `
    <div style="display:flex;gap:12px">
      <div class="card small">Active<br><strong>${requests.length}</strong></div>
      <div class="card small">Families<br><strong>${requests.reduce((s,r) => s + (r.household_size||0), 0)}</strong></div>
      <div class="card small">Cities<br><strong>${new Set(requests.map(r => r.city).filter(Boolean)).size}</strong></div>
      <div class="card small">Critical<br><strong>${requests.filter(r => r.urgency_level === 'critical').length}</strong></div>
    </div>
  `;
  
  // Map
  const mapEl = document.getElementById('map');
  mapEl.style.height = '420px';
  const map = L.map(mapEl).setView([20.5937, 78.9629], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);
  
  // Add markers
  requests.forEach(r => {
    if (r.latitude && r.longitude) {
      L.marker([r.latitude, r.longitude])
        .bindPopup(`<strong>${r.requester_name}</strong><br>${r.city}<br><span class="badge">${r.urgency_level}</span>`)
        .addTo(map);
    }
  });
  
  // User location
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      map.setView([pos.coords.latitude, pos.coords.longitude], 12);
    });
  }
}

// Request food form
function renderRequestForm() {
  pageTitle.textContent = 'Request Food Assistance';
  root.innerHTML = `
    <div class="card">
      <h3>Food Assistance Request Form</h3>
      <form id="requestForm">
        <div class="form-row">
          <div><label>Your Name *</label><input id="name" required></div>
          <div><label>Phone Number *</label><input id="phone" required></div>
        </div>
        <div><label>Street Address *</label><input id="address" required></div>
        <div class="form-row">
          <div><label>City *</label><input id="city" required></div>
          <div><label>State</label><input id="state"></div>
        </div>
        <div class="form-row">
          <div><label>Number of People *</label><input id="people" type="number" value="1" required></div>
          <div><label>Urgency Level</label>
            <select id="urgency">
              <option value="low">Low</option>
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>
        <div><label>Dietary Restrictions</label><input id="dietary" placeholder="e.g., vegetarian"></div>
        <div>
          <label>Types of Food Needed</label>
          <div id="foodTypes" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:8px"></div>
        </div>
        <div><label>Additional Notes</label><textarea id="notes" rows="3"></textarea></div>
        <div style="margin-top:12px"><button class="button" type="submit">Submit Request</button></div>
      </form>
    </div>
  `;
  
  // Food type checkboxes
  const foodTypes = ['fresh_produce', 'canned_goods', 'dairy', 'meat', 'bread', 'baby_food', 'snacks', 'beverages', 'meals'];
  const ftEl = document.getElementById('foodTypes');
  foodTypes.forEach(t => {
    ftEl.innerHTML += `<label><input type="checkbox" value="${t}"> ${t.replace('_', ' ')}</label>`;
  });
  
  // Form submit
  document.getElementById('requestForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const selectedFood = Array.from(form.querySelectorAll('#foodTypes input:checked')).map(i => i.value);
    
    const request = {
      id: Date.now(),
      requester_name: form.name.value.trim(),
      contact_phone: form.phone.value.trim(),
      address: form.address.value.trim(),
      city: form.city.value.trim(),
      state: form.state.value.trim(),
      household_size: Number(form.people.value) || 1,
      dietary_restrictions: form.dietary.value.trim(),
      urgency_level: form.urgency.value,
      food_types_needed: selectedFood,
      additional_notes: form.notes.value.trim(),
      status: 'active',
      created_date: new Date().toISOString()
    };
    
    // Simple geocoding (using hardcoded for simplicity)
    if (request.city.toLowerCase() === 'mumbai') {
      request.latitude = 19.0760;
      request.longitude = 72.8777;
    } else if (request.city.toLowerCase() === 'delhi') {
      request.latitude = 28.6139;
      request.longitude = 77.2090;
    }
    
    const requests = db.getRequests();
    requests.unshift(request);
    await db.saveRequests(requests);
    
    alert('Request submitted!');
    location.hash = '#home';
  };
}

// Browse requests
function renderBrowse() {
  pageTitle.textContent = 'Browse Requests';
  root.innerHTML = `
    <div class="card">
      <h3>Filter Requests</h3>
      <div style="display:flex;gap:8px;margin-top:8px">
        <input id="search" class="input" placeholder="Search...">
        <select id="urgencyFilter" class="input">
          <option value="all">All Urgency</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <button id="filterBtn" class="button">Apply</button>
      </div>
    </div>
    <div class="card">
      <h3>Requests</h3>
      <div id="requestsGrid" class="request-list" style="margin-top:12px"></div>
    </div>
  `;
  
  document.getElementById('filterBtn').onclick = showRequests;
  showRequests();
  
  function showRequests() {
    const search = document.getElementById('search').value.toLowerCase();
    const urgency = document.getElementById('urgencyFilter').value;
    
    let requests = db.getRequests();
    if (search) requests = requests.filter(r => 
      r.requester_name.toLowerCase().includes(search) || 
      r.city.toLowerCase().includes(search)
    );
    if (urgency !== 'all') requests = requests.filter(r => r.urgency_level === urgency);
    
    const grid = document.getElementById('requestsGrid');
    grid.innerHTML = '';
    
    requests.forEach(r => {
      grid.innerHTML += `
        <div class="request fade-in">
          <h4>${r.requester_name}</h4>
          <div class="small">${r.address}, ${r.city}</div>
          <div><strong>${r.household_size} people</strong> • <span class="badge">${r.urgency_level}</span></div>
          <div>${r.food_types_needed?.slice(0,3).join(', ') || ''}</div>
          <div style="margin-top:10px;display:flex;gap:8px">
            <button class="button" onclick="contact('${r.contact_phone}')">Help This Family</button>
            <button onclick="window.open('https://maps.google.com/?q=${r.address}+${r.city}', '_blank')" style="padding:8px;border-radius:8px;border:1px solid #ddd">Directions</button>
          </div>
        </div>
      `;
    });
  }
}

// Profile/Login
function renderProfile() {
  pageTitle.textContent = 'My Profile';
  const session = db.getSession();
  
  root.innerHTML = `
    <div class="card">
      <h3>Profile / Sign In</h3>
      <div id="authWrap">
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <button id="loginBtn" class="button">Login</button>
          <button id="registerBtn" class="button">Register</button>
          ${session ? '<button id="logoutBtn" class="button">Sign Out</button>' : ''}
        </div>
        <div id="authArea">
          ${session ? `<div>Signed in as <strong>${session.full_name}</strong></div>` : ''}
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('loginBtn').onclick = () => showAuth('login');
  document.getElementById('registerBtn').onclick = () => showAuth('register');
  if (session) {
    document.getElementById('logoutBtn').onclick = async () => {
      await db.clearSession();
      updateUI();
      location.hash = '#home';
    };
  }
  
  function showAuth(type) {
    const authArea = document.getElementById('authArea');
    if (type === 'login') {
      authArea.innerHTML = `
        <form id="loginForm">
          <div><label>Email</label><input id="email" type="email" required></div>
          <div><label>Password</label><input id="password" type="password" required></div>
          <div style="margin-top:10px"><button class="button" type="submit">Login</button></div>
        </form>
      `;
      
      document.getElementById('loginForm').onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const users = db.getUsers();
        
        if (users[email] && users[email].password === password) {
          await db.saveSession(users[email]);
          updateUI();
          location.hash = '#home';
        } else {
          alert('Invalid credentials');
        }
      };
    } else {
      authArea.innerHTML = `
        <form id="registerForm">
          <div><label>Full Name</label><input id="name" required></div>
          <div><label>Email</label><input id="email" type="email" required></div>
          <div><label>Password</label><input id="password" type="password" required></div>
          <div><label>I am a...</label>
            <select id="type">
              <option value="donor">Food Donor</option>
              <option value="recipient">Person in Need</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div style="margin-top:10px"><button class="button" type="submit">Register</button></div>
        </form>
      `;
      
      document.getElementById('registerForm').onsubmit = async (e) => {
        e.preventDefault();
        const name = document.getElementById('name').value.trim();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const type = document.getElementById('type').value;
        
        const users = db.getUsers();
        if (users[email]) {
          alert('User already exists');
          return;
        }
        
        users[email] = { full_name: name, email, password, user_type: type };
        await db.saveUsers(users);
        await db.saveSession(users[email]);
        
        updateUI();
        location.hash = '#home';
      };
    }
  }
}

// Helper function
function contact(phone) {
  if (phone) {
    window.open('tel:' + phone, '_self');
  } else {
    alert('Phone number not available');
  }
}

// Async startup: load data from Firestore, seed if empty, then render
(async function start() {
  await initData();

  if (db.getRequests().length === 0) {
    await db.saveRequests([
      {
        id: Date.now(),
        requester_name: 'Dia Sharma(Mock)',
        contact_phone: '+91 9988776655',
        address: '123 Park Lane',
        city: 'Mumbai',
        state: 'MH',
        zip_code: '400001',
        latitude: 19.0760,
        longitude: 72.8777,
        household_size: 4,
        dietary_restrictions: '',
        urgency_level: 'medium',
        food_types_needed: ['meals', 'bread'],
        additional_notes: 'Can collect after 5pm',
        status: 'active',
        created_date: new Date().toISOString()
      }
    ]);
  }

  updateUI();
  const hash = location.hash.replace('#', '') || 'home';
  if (routes[hash]) routes[hash](); else renderHome();
})();