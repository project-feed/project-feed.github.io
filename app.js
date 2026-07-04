/* ==========================================================================
   Project-feed Core Frontend Engine (app.js)
   ========================================================================== */

// Import Firebase initialized instances
import { auth, db } from './config/firebase.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

// Application State
const state = {
  projects: [],
  searchQuery: "",
  selectedCategory: "ALL",
  selectedTag: "ALL",
  sortBy: "likes", // Default sort: likes. Options: likes, createdAt, name
  currentUser: null,
  userProfile: null
};

// DOM Cache
const appContainer = document.getElementById("app");
const themeToggleBtn = document.getElementById("theme-toggle-btn");
const themeIcon = document.getElementById("theme-icon");
const themeText = document.getElementById("theme-text");

// ==========================================================================
// Theme Management (Monochrome B&W Toggle)
// ==========================================================================

function initTheme() {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeUI(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const newTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", newTheme);
  localStorage.setItem("theme", newTheme);
  updateThemeUI(newTheme);
}

function updateThemeUI(theme) {
  if (theme === "dark") {
    themeIcon.textContent = "◆";
    themeText.textContent = "LIGHT";
  } else {
    themeIcon.textContent = "◇";
    themeText.textContent = "DARK";
  }
}

themeToggleBtn.addEventListener("click", toggleTheme);

// ==========================================================================
// Data Manager (Fetching static JSON files)
// ==========================================================================

async function fetchJSON(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching file [${path}]:`, error);
    throw error;
  }
}

async function loadInitialData() {
  try {
    state.projects = await fetchJSON("./projects/index.json");
  } catch (error) {
    appContainer.innerHTML = `
      <div class="error-msg">
        <h3>데이터베이스 로딩 실패</h3>
        <p>프로젝트 데이터를 가져오는 데 실패했습니다. 로컬 서버(Live Server 등)를 사용하여 실행하고 있는지 확인해 주세요.</p>
        <button class="btn" onclick="location.reload()" style="margin-top: 15px;">다시 시도</button>
      </div>
    `;
    throw error;
  }
}

// ==========================================================================
// Helper Functions
// ==========================================================================

function safeMarkdown(content) {
  if (typeof marked !== 'undefined') {
    try {
      // Setup marked options for safe rendering and line breaks
      marked.setOptions({
        breaks: true,
        gfm: true
      });
      return window.marked.parse ? window.marked.parse(content) : window.marked(content);
    } catch (e) {
      console.error("Markdown parsing failed:", e);
      return `<pre style="white-space: pre-wrap;">${escapeHTML(content)}</pre>`;
    }
  }
  return `<pre style="white-space: pre-wrap;">${escapeHTML(content)}</pre>`;
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// ==========================================================================
// Routing Engine (Hash Routing)
// ==========================================================================

const routes = {
  feed: /^(#\/)?$/,
  project: /^#\/project\/([a-zA-Z0-9\-_]+)$/,
  user: /^#\/user\/([a-zA-Z0-9\-_]+)$/,
  submit: /^#\/submit$/,
  login: /^#\/login$/,
  editProfile: /^#\/profile\/edit$/
};

async function router() {
  const hash = window.location.hash || "#/";
  
  // Update Navigation Active State
  const feedLink = document.getElementById("nav-feed");
  const submitLink = document.getElementById("nav-submit");
  const loginLink = document.getElementById("nav-login");
  const editProfileLink = document.getElementById("nav-edit-profile");
  
  if (feedLink) feedLink.classList.remove("active");
  if (submitLink) submitLink.classList.remove("active");
  if (loginLink) loginLink.classList.remove("active");
  if (editProfileLink) editProfileLink.classList.remove("active");

  // Load database index if not loaded
  if (state.projects.length === 0) {
    try {
      await loadInitialData();
    } catch (e) {
      return; // Stop routing if initial data failed
    }
  }

  // Block unverified users from accessing anything other than login/verification pending
  if (state.currentUser && !state.currentUser.emailVerified) {
    renderVerificationPendingPage();
    return;
  }

  // Routing Matches
  if (routes.feed.test(hash)) {
    if (feedLink) feedLink.classList.add("active");
    renderFeedPage();
  } else if (routes.submit.test(hash)) {
    if (submitLink) submitLink.classList.add("active");
    renderSubmitPage();
  } else if (routes.login.test(hash)) {
    if (loginLink) loginLink.classList.add("active");
    renderLoginPage();
  } else if (routes.editProfile.test(hash)) {
    if (editProfileLink) editProfileLink.classList.add("active");
    renderEditProfilePage();
  } else {
    const projectMatch = hash.match(routes.project);
    if (projectMatch) {
      const projectId = projectMatch[1];
      renderProjectDetailPage(projectId);
      return;
    }

    const userMatch = hash.match(routes.user);
    if (userMatch) {
      const username = userMatch[1];
      renderUserProfilePage(username);
      return;
    }

    // Default 404
    render404();
  }
}

// User Navigation header UI
function updateUserHeaderUI() {
  const container = document.getElementById("user-nav-container");
  if (!container) return;

  if (state.currentUser) {
    // Determine display name and username fallback
    let nickname = state.currentUser.displayName || state.currentUser.email.split("@")[0];
    const username = (state.userProfile && state.userProfile.username) || nickname;
    const avatar = (state.userProfile && state.userProfile.avatar) || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&h=150&fit=crop";

    if (state.currentUser.emailVerified) {
      container.innerHTML = `
        <a href="#/user/${escapeHTML(username)}" class="user-menu-btn" id="header-profile-link">
          <img src="${escapeHTML(avatar)}" width="20" height="20" style="border-radius: 50%;">
          <span>${escapeHTML(nickname)}</span>
        </a>
        <a href="#/profile/edit" class="nav-link" id="nav-edit-profile">Edit</a>
        <button class="btn" id="logout-btn" style="padding: 4px 8px; font-size: 11px;">Logout</button>
      `;
    } else {
      // Logged in but NOT verified
      container.innerHTML = `
        <span style="font-size: 11px; color: var(--accent-color);">[Pending Verification]</span>
        <button class="btn" id="logout-btn" style="padding: 4px 8px; font-size: 11px;">Logout</button>
      `;
    }

    // Bind logout
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", handleLogout);
    }
  } else {
    // Guest
    container.innerHTML = `
      <a href="#/login" class="nav-link" id="nav-login">Login</a>
    `;
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    window.location.hash = "#/";
  } catch (e) {
    alert("로그아웃 실패: " + e.message);
  }
}

// Listen to Hash Changes
window.addEventListener("hashchange", router);

// Initialize Auth State Listener
auth.onAuthStateChanged(async (user) => {
  state.currentUser = user;
  
  if (user) {
    if (user.emailVerified) {
      const email = user.email || '';
      const username = email.split('@')[0];
      try {
        const profile = await fetchJSON(`./users/${username}.json`);
        state.userProfile = profile;
      } catch (e) {
        console.error('User profile JSON load failed:', e);
        state.userProfile = null;
      }
    } else {
      state.userProfile = null;
    }
  } else {
    state.currentUser = null;
    state.userProfile = null;
  }
  
  updateUserHeaderUI();
  router();
});

window.addEventListener("DOMContentLoaded", () => {
  initTheme();
});

// ==========================================================================
// Page Renderers
// ==========================================================================

// 1. Main Project Feed Page
function renderFeedPage() {
  appContainer.innerHTML = `
    <div class="split-layout">
      <!-- Sidebar Panel -->
      <aside class="sidebar">
        <!-- Search -->
        <div class="widget">
          <h3 class="widget-title">Search</h3>
          <div class="search-container">
            <input type="text" class="search-input" id="search-box" placeholder="키워드 입력..." value="${escapeHTML(state.searchQuery)}">
          </div>
        </div>

        <!-- Categories -->
        <div class="widget">
          <h3 class="widget-title">Categories</h3>
          <div class="filter-list" id="category-filter-list">
            <!-- Dynamically populated -->
          </div>
        </div>

        <!-- Tags -->
        <div class="widget">
          <h3 class="widget-title">Popular Tags</h3>
          <div class="tag-cloud" id="tag-cloud-list">
            <!-- Dynamically populated -->
          </div>
        </div>
      </aside>

      <!-- Main Project List -->
      <section class="main-content">
        <div class="feed-header">
          <div class="results-count" id="results-count-el">Projects (0)</div>
          <div class="sort-select-wrapper">
            <span class="sort-label">Sort:</span>
            <select class="sort-select" id="sort-select-el">
              <option value="likes" ${state.sortBy === "likes" ? "selected" : ""}>Likes</option>
              <option value="createdAt" ${state.sortBy === "createdAt" ? "selected" : ""}>Recent</option>
              <option value="name" ${state.sortBy === "name" ? "selected" : ""}>Alphabetical</option>
            </select>
          </div>
        </div>

        <div class="projects-grid" id="projects-grid-el">
          <!-- Dynamically rendered project cards -->
        </div>
      </section>
    </div>
  `;

  // Bind Sidebar items and filter lists
  updateSidebarUI();
  updateProjectsList();

  // Attach search event
  const searchBox = document.getElementById("search-box");
  searchBox.addEventListener("input", (e) => {
    state.searchQuery = e.target.value.trim();
    updateProjectsList();
  });

  // Attach sort event
  const sortSelect = document.getElementById("sort-select-el");
  sortSelect.addEventListener("change", (e) => {
    state.sortBy = e.target.value;
    updateProjectsList();
  });
}

// Render dynamic elements inside sidebar

// 2. 로그인 페이지 렌더링
function renderLoginPage() {
  appContainer.innerHTML = `
    <div class="login-page">
      <h2 class="login-title">로그인</h2>
      <div class="form-group">
        <label for="login-email">이메일</label>
        <input type="email" id="login-email" class="form-control" placeholder="you@example.com" required />
      </div>
      <div class="form-group">
        <label for="login-password">비밀번호</label>
        <input type="password" id="login-password" class="form-control" placeholder="비밀번호" required />
      </div>
      <button class="btn" id="login-btn">로그인</button>
      <div id="login-error" class="error-msg" style="margin-top:10px;"></div>
      <div class="login-links" style="margin-top:15px;">
        <a href="#/submit" class="nav-link">회원가입</a> |
        <a href="#" id="reset-password-link" class="nav-link">비밀번호 재설정</a>
      </div>
    </div>
  `;

  // 로그인 버튼 이벤트
  document.getElementById('login-btn').addEventListener('click', async () => {
    const email = (document.getElementById('login-email').value || '').trim();
    const password = document.getElementById('login-password').value;
    const errorDiv = document.getElementById('login-error');
    errorDiv.textContent = '';
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // 로그인 성공 시 라우터 재실행 (auth 상태 리스너에서 자동 처리)
      router();
    } catch (e) {
      console.error('Login failed:', e);
      errorDiv.textContent = '로그인 실패: ' + e.message;
    }
  });

  // 비밀번호 재설정 링크 (Firebase 비밀번호 재설정 메일 발송)
  document.getElementById('reset-password-link').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = (document.getElementById('login-email').value || '').trim();
    if (!email) {
      alert('비밀번호 재설정을 위해 이메일을 입력해주세요.');
      return;
    }
    try {
      await auth.sendPasswordResetEmail(email);
      alert('비밀번호 재설정 메일이 발송되었습니다.');
    } catch (err) {
      alert('메일 발송 실패: ' + err.message);
    }
  });
}

// ==========================================================================
// Page Renderers
// ===========================================================================
function updateSidebarUI() {
  const categoryFilterList = document.getElementById("category-filter-list");
  const tagCloudList = document.getElementById("tag-cloud-list");
  
  if (!categoryFilterList || !tagCloudList) return;

  // 1. Categories counting
  const categories = { "ALL": state.projects.length };
  state.projects.forEach(p => {
    if (p.category) {
      categories[p.category] = (categories[p.category] || 0) + 1;
    }
  });

  // Populate categories list HTML
  categoryFilterList.innerHTML = Object.entries(categories).map(([name, count]) => `
    <button class="filter-btn ${state.selectedCategory === name ? 'active' : ''}" data-category="${name}">
      <span>${name}</span>
      <span class="count">${count}</span>
    </button>
  `).join("");

  // Attach click events to categories
  categoryFilterList.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedCategory = btn.getAttribute("data-category");
      state.selectedTag = "ALL"; // Reset tag selection when choosing category
      
      // Update active styling
      categoryFilterList.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      // Sync tag clouds
      updateSidebarUI();
      updateProjectsList();
    });
  });

  // 2. Tags listing
  const tagCounts = {};
  state.projects.forEach(p => {
    if (state.selectedCategory !== "ALL" && p.category !== state.selectedCategory) return;
    if (p.tags && Array.isArray(p.tags)) {
      p.tags.forEach(t => {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });
    }
  });

  // Sort tags by frequency
  const sortedTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);

  tagCloudList.innerHTML = `
    <button class="tag-btn ${state.selectedTag === 'ALL' ? 'active' : ''}" data-tag="ALL">#all</button>
    ${sortedTags.map(tag => `
      <button class="tag-btn ${state.selectedTag === tag ? 'active' : ''}" data-tag="${tag}">#${tag}</button>
    `).join("")}
  `;

  // Attach click events to tags
  tagCloudList.querySelectorAll(".tag-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedTag = btn.getAttribute("data-tag");
      
      // Update active styling
      tagCloudList.querySelectorAll(".tag-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      updateProjectsList();
    });
  });
}

// Filter, sort, and render projects
function updateProjectsList() {
  const projectsGrid = document.getElementById("projects-grid-el");
  const resultsCountEl = document.getElementById("results-count-el");
  if (!projectsGrid) return;

  // Filter
  let filtered = state.projects.filter(p => {
    // 1. Category Filter
    if (state.selectedCategory !== "ALL" && p.category !== state.selectedCategory) {
      return false;
    }
    // 2. Tag Filter
    if (state.selectedTag !== "ALL" && (!p.tags || !p.tags.includes(state.selectedTag))) {
      return false;
    }
    // 3. Search query
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const nameMatch = p.name ? p.name.toLowerCase().includes(q) : false;
      const descMatch = p.description ? p.description.toLowerCase().includes(q) : false;
      const authorMatch = p.author ? p.author.toLowerCase().includes(q) : false;
      const tagMatch = p.tags ? p.tags.some(t => t.toLowerCase().includes(q)) : false;
      return nameMatch || descMatch || authorMatch || tagMatch;
    }
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    if (state.sortBy === "likes") {
      const likesA = (a.stats && a.stats.likes) || 0;
      const likesB = (b.stats && b.stats.likes) || 0;
      return likesB - likesA;
    } else if (state.sortBy === "createdAt") {
      return new Date(b.createdAt) - new Date(a.createdAt);
    } else if (state.sortBy === "name") {
      return a.name.localeCompare(b.name);
    }
    return 0;
  });

  // Update Count
  resultsCountEl.textContent = `Projects (${filtered.length})`;

  // Render cards
  if (filtered.length === 0) {
    projectsGrid.innerHTML = `
      <div style="border: 2px dashed var(--border-color); padding: 40px; text-align: center; font-weight: 700;">
        검색 결과에 맞는 프로젝트가 없습니다.
      </div>
    `;
    return;
  }

  projectsGrid.innerHTML = filtered.map(p => {
    const imageHTML = p.image ? `
      <div class="project-card-image-wrapper">
        <img src="${escapeHTML(p.image)}" class="project-card-img" alt="${escapeHTML(p.name)} Thumbnail">
      </div>
    ` : `
      <div class="project-card-image-wrapper">
        <div class="project-card-placeholder">
          <span>◇</span>
          <span style="font-size: 10px; text-transform: uppercase; letter-spacing: 1px;">${escapeHTML(p.category)}</span>
        </div>
      </div>
    `;

    return `
      <a href="#/project/${p.id}" class="project-card">
        ${imageHTML}
        <div class="project-card-body">
          <div class="project-card-title-row">
            <h4 class="project-card-title">${escapeHTML(p.name)}</h4>
            <span class="project-card-category">${escapeHTML(p.category)}</span>
          </div>
          <p class="project-card-desc">${escapeHTML(p.description)}</p>
          
          <div class="project-card-footer">
            <div class="project-card-meta-row">
              <div>
                by <span class="project-card-author" data-username="${escapeHTML(p.author)}">${escapeHTML(p.author)}</span>
              </div>
              <div class="card-stats">
                <span class="stat-item">⭐ ${(p.stats && p.stats.likes) || 0}</span>
                <span class="stat-item">👁️ ${(p.stats && p.stats.views) || 0}</span>
              </div>
            </div>
            <div class="project-card-tags">
              ${(p.tags || []).map(t => `<span>#${escapeHTML(t)}</span>`).join(" ")}
            </div>
          </div>
        </div>
      </a>
    `;
  }).join("");

  // Attach stopPropagation to author links inside cards to prevent triggering project click
  projectsGrid.querySelectorAll(".project-card-author").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const username = link.getAttribute("data-username");
      window.location.hash = `#/user/${username}`;
    });
  });
}

// 2. Project Detail Page
async function renderProjectDetailPage(projectId) {
  appContainer.innerHTML = `<div class="loading">Loading project detail [${escapeHTML(projectId)}]...</div>`;

  try {
    const project = await fetchJSON(`./projects/${projectId}.json`);
    
    appContainer.innerHTML = `
      <div class="back-btn-container">
        <a href="#/" class="btn">&larr; Back to Feed</a>
      </div>

      <div class="project-detail-layout">
        <!-- Main Project Description -->
        <article class="project-main">
          <h1 class="project-detail-title">${escapeHTML(project.name)}</h1>
          
          <div class="project-detail-meta">
            <span>Author: <a href="#/user/${escapeHTML(project.author)}">${escapeHTML(project.author)}</a></span>
            <span>Created: ${project.createdAt}</span>
            ${project.updatedAt ? `<span>Updated: ${project.updatedAt}</span>` : ""}
            <span>Category: <strong>${escapeHTML(project.category)}</strong></span>
          </div>

          <!-- Representative Image Banner if exists -->
          ${project.image ? `
            <div class="project-banner-container">
              <img src="${escapeHTML(project.image)}" class="project-banner" alt="${escapeHTML(project.name)} Representative Image">
            </div>
          ` : ""}

          <!-- Markdown Content Body -->
          <div class="project-content">
            ${safeMarkdown(project.content || "상세 설명이 비어 있습니다.")}
          </div>
        </article>

        <!-- Sidebar Actions & Stats Info -->
        <aside class="project-sidebar">
          <!-- Quick Info -->
          <div class="info-card">
            <h4 class="info-card-title">Project Info</h4>
            <div class="info-grid">
              <div class="info-row">
                <span class="info-label">License</span>
                <span class="info-value">${escapeHTML(project.license || "None")}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Views</span>
                <span class="info-value">${(project.stats && project.stats.views) || 0}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Likes</span>
                <span class="info-value">${(project.stats && project.stats.likes) || 0}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Bookmarks</span>
                <span class="info-value">${(project.stats && project.stats.bookmarks) || 0}</span>
              </div>
            </div>

            <div class="action-buttons">
              ${project.githubLink ? `
                <a href="${escapeHTML(project.githubLink)}" target="_blank" rel="noopener" class="btn">GitHub Repository</a>
              ` : ""}
              ${project.websiteLink ? `
                <a href="${escapeHTML(project.websiteLink)}" target="_blank" rel="noopener" class="btn">Visit Website</a>
              ` : ""}
            </div>
          </div>

          <!-- Interactions Panel (Placeholder for Phase 3 Firebase integrations) -->
          <div class="info-card">
            <h4 class="info-card-title">Interactions</h4>
            <div class="interact-panel">
              <button class="interact-btn" id="like-btn">⭐ Like (${(project.stats && project.stats.likes) || 0})</button>
              <button class="interact-btn" id="bookmark-btn">🔖 Save</button>
            </div>
            
            <!-- Comments section placeholder -->
            <div style="margin-top: 20px; font-size: 12px; border-top: 1px dashed var(--border-color); padding-top: 15px;">
              <h5 style="font-weight: 800; margin-bottom: 10px;">Comments (${(project.stats && project.stats.comments) || 0})</h5>
              <div style="border: 2px dashed var(--border-color); padding: 10px; text-align: center; opacity: 0.7;">
                로그인 후 댓글을 작성할 수 있습니다 (2단계 예정).
              </div>
            </div>
          </div>
        </aside>
      </div>
    `;

    // Simple interaction clicks feedback (Phase 1 local visual feedback only)
    document.getElementById("like-btn").addEventListener("click", () => {
      alert("로그인이 필요합니다. (2단계 구현 예정)");
    });
    document.getElementById("bookmark-btn").addEventListener("click", () => {
      alert("로그인이 필요합니다. (2단계 구현 예정)");
    });

  } catch (error) {
    appContainer.innerHTML = `
      <div class="error-msg">
        <h3>프로젝트 상세 정보 로드 실패</h3>
        <p>프로젝트 데이터를 가져오는 데 실패했습니다. 파일이 존재하는지 확인해 주세요.</p>
        <a href="#/" class="btn" style="margin-top: 15px; display: inline-block;">피드로 돌아가기</a>
      </div>
    `;
  }
}

// 3. User Profile Page
async function renderUserProfilePage(username) {
  appContainer.innerHTML = `<div class="loading">Loading user profile [${escapeHTML(username)}]...</div>`;

  try {
    const user = await fetchJSON(`./users/${username}.json`);
    
    // Find all projects created by this user
    const userProjects = state.projects.filter(p => p.author === username);

    appContainer.innerHTML = `
      <div class="back-btn-container">
        <a href="#/" class="btn">&larr; Back to Feed</a>
      </div>

      <div class="profile-header-card">
        <img src="${escapeHTML(user.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&h=150&fit=crop')}" class="profile-avatar" alt="${escapeHTML(user.nickname)} Avatar">
        <div class="profile-details">
          <h2 class="profile-name">${escapeHTML(user.nickname)}</h2>
          <div class="profile-username">@${escapeHTML(user.username)}</div>
          <p class="profile-bio">${escapeHTML(user.bio || "소개가 없습니다.")}</p>
          <div class="profile-meta">
            Joined: ${user.joinedAt} · Projects Published: ${userProjects.length}
          </div>
        </div>
      </div>

      <div class="profile-projects-section">
        <h3 class="profile-projects-title">Projects by ${escapeHTML(user.nickname)}</h3>
        <div class="projects-grid">
          ${userProjects.length === 0 ? `
            <div style="border: 2px dashed var(--border-color); padding: 40px; text-align: center; font-weight: 700;">
              등록된 프로젝트가 없습니다.
            </div>
          ` : userProjects.map(p => {
            const imageHTML = p.image ? `
              <div class="project-card-image-wrapper">
                <img src="${escapeHTML(p.image)}" class="project-card-img" alt="${escapeHTML(p.name)} Thumbnail">
              </div>
            ` : `
              <div class="project-card-image-wrapper">
                <div class="project-card-placeholder">
                  <span>◇</span>
                  <span style="font-size: 10px; text-transform: uppercase; letter-spacing: 1px;">${escapeHTML(p.category)}</span>
                </div>
              </div>
            `;

            return `
              <a href="#/project/${p.id}" class="project-card">
                ${imageHTML}
                <div class="project-card-body">
                  <div class="project-card-title-row">
                    <h4 class="project-card-title">${escapeHTML(p.name)}</h4>
                    <span class="project-card-category">${escapeHTML(p.category)}</span>
                  </div>
                  <p class="project-card-desc">${escapeHTML(p.description)}</p>
                  
                  <div class="project-card-footer">
                    <div class="project-card-meta-row">
                      <div>
                        by <strong>${escapeHTML(p.author)}</strong>
                      </div>
                      <div class="card-stats">
                        <span class="stat-item">⭐ ${(p.stats && p.stats.likes) || 0}</span>
                        <span class="stat-item">👁️ ${(p.stats && p.stats.views) || 0}</span>
                      </div>
                    </div>
                    <div class="project-card-tags">
                      ${(p.tags || []).map(t => `<span>#${escapeHTML(t)}</span>`).join(" ")}
                    </div>
                  </div>
                </div>
              </a>
            `;
          }).join("")}
        </div>
      </div>
    `;

  } catch (error) {
    appContainer.innerHTML = `
      <div class="error-msg">
        <h3>사용자 프로필 로드 실패</h3>
        <p>프로필 정보를 불러오는 데 실패했습니다. 파일이 존재하는지 확인해 주세요.</p>
        <a href="#/" class="btn" style="margin-top: 15px; display: inline-block;">피드로 돌아가기</a>
      </div>
    `;
  }
}

// 4. Project Upload Guide / Submission Form Page
function renderSubmitPage() {
  appContainer.innerHTML = `
    <div class="submit-container">
      <div class="submit-header">
        <h2 class="submit-title">Submit Project</h2>
        <p class="submit-subtitle">"모든 것은 파일이다" — 깃허브 저장소에 데이터를 등록하여 공유하세요.</p>
      </div>

      <div class="guide-box">
        <h4>💡 등록 방법 안내</h4>
        <ol>
          <li>아래 폼에 프로젝트 정보를 채웁니다.</li>
          <li>하단에 생성된 <strong>JSON 파일 소스 코드</strong>를 복사합니다.</li>
          <li>로컬 저장소의 <code>/projects/{project-id}.json</code>에 저장합니다.</li>
          <li><code>/projects/index.json</code> 리스트 최상단에 프로젝트 요약 정보를 추가합니다.</li>
          <li>레포지토리에 커밋 후 푸시하면 GitHub Pages에 실시간으로 반영됩니다!</li>
        </ol>
      </div>

      <form id="submission-form" onsubmit="return false;">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="proj-id">Project ID (Unique 영문/숫자)</label>
            <input type="text" class="form-control" id="proj-id" placeholder="예: my-awesome-tool" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="proj-name">Project Name</label>
            <input type="text" class="form-control" id="proj-name" placeholder="프로젝트명 입력" required>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="proj-desc">Short Description (한 줄 요약)</label>
          <input type="text" class="form-control" id="proj-desc" placeholder="리스트에 보여줄 한 줄 요약을 입력하세요." required>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="proj-category">Category</label>
            <select class="form-control" id="proj-category" required>
              <option value="Web">Web</option>
              <option value="Mobile">Mobile</option>
              <option value="AI">AI</option>
              <option value="Game">Game</option>
              <option value="Library">Library</option>
              <option value="Tool">Tool</option>
              <option value="Hardware">Hardware</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="proj-tags">Tags (쉼표로 구분)</label>
            <input type="text" class="form-control" id="proj-tags" placeholder="예: web, game, canvas">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="proj-author">Author (GitHub ID)</label>
            <input type="text" class="form-control" id="proj-author" placeholder="작성자 명칭" value="hj" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="proj-license">License</label>
            <input type="text" class="form-control" id="proj-license" placeholder="예: MIT, Apache-2.0" value="MIT" required>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="proj-github">GitHub Repo Link (선택)</label>
            <input type="url" class="form-control" id="proj-github" placeholder="https://github.com/username/repo">
          </div>
          <div class="form-group">
            <label class="form-label" for="proj-web">Website Link (선택)</label>
            <input type="url" class="form-control" id="proj-web" placeholder="https://username.github.io/repo">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="proj-image">Representative Image Path (대표 이미지, 선택)</label>
          <input type="text" class="form-control" id="proj-image" placeholder="예: assets/my-project-preview.png">
        </div>

        <div class="form-group">
          <label class="form-label" for="proj-content">Markdown Description (상세 설명, Markdown 지원)</label>
          <textarea class="form-control" id="proj-content" placeholder="# 내 프로젝트 설명&#10;&#10;마크다운 형식을 자유롭게 기입하여 설명을 완성하세요." required></textarea>
        </div>
      </form>

      <div class="generator-output">
        <h3 class="generator-output-title">📋 1. 생성된 Project Detail JSON</h3>
        <p style="font-size: 11px; color: var(--accent-color); margin-bottom: 8px;">복사해서 <code>/projects/{project-id}.json</code> 경로에 새 파일로 생성하세요.</p>
        <div class="code-wrapper">
          <textarea class="code-box" id="detail-json-box" readonly>JSON 파일 정보가 여기에 실시간으로 표시됩니다...</textarea>
        </div>
        <button class="btn" id="copy-detail-btn">Copy Detail JSON</button>
      </div>

      <div class="generator-output" style="margin-top: 20px;">
        <h3 class="generator-output-title">📋 2. 생성된 index.json 추가 엔트리</h3>
        <p style="font-size: 11px; color: var(--accent-color); margin-bottom: 8px;">복사해서 <code>/projects/index.json</code> 배열의 최상단(첫 번째 원소)으로 병합하세요.</p>
        <div class="code-wrapper">
          <textarea class="code-box" id="index-json-box" style="height: 120px;" readonly>index.json 용 요약 데이터가 실시간으로 표시됩니다...</textarea>
        </div>
        <button class="btn" id="copy-index-btn">Copy Index Entry</button>
      </div>
    </div>
  `;

  // Attach change listeners to form to update JSON previews live
  const formFields = [
    "proj-id", "proj-name", "proj-desc", "proj-category",
    "proj-tags", "proj-author", "proj-license", "proj-github",
    "proj-web", "proj-image", "proj-content"
  ];

  formFields.forEach(id => {
    document.getElementById(id).addEventListener("input", updateGeneratedJSON);
  });

  document.getElementById("copy-detail-btn").addEventListener("click", () => {
    const box = document.getElementById("detail-json-box");
    box.select();
    document.execCommand("copy");
    alert("Project Detail JSON이 클립보드에 복사되었습니다!");
  });

  document.getElementById("copy-index-btn").addEventListener("click", () => {
    const box = document.getElementById("index-json-box");
    box.select();
    document.execCommand("copy");
    alert("Index Entry가 클립보드에 복사되었습니다!");
  });

  // Run initial generator call
  updateGeneratedJSON();
}

function updateGeneratedJSON() {
  const projId = document.getElementById("proj-id").value.trim() || "untitled-project";
  const projName = document.getElementById("proj-name").value.trim() || "Untitled Project";
  const projDesc = document.getElementById("proj-desc").value.trim() || "프로젝트 한 줄 설명";
  const projCategory = document.getElementById("proj-category").value;
  const rawTags = document.getElementById("proj-tags").value;
  const projAuthor = document.getElementById("proj-author").value.trim() || "anonymous";
  const projLicense = document.getElementById("proj-license").value.trim() || "MIT";
  const projGithub = document.getElementById("proj-github").value.trim() || "";
  const projWeb = document.getElementById("proj-web").value.trim() || "";
  const projImage = document.getElementById("proj-image").value.trim() || "";
  const projContent = document.getElementById("proj-content").value || "# " + projName + "\n\n설명이 비어 있습니다.";

  // Split tags by comma and trim whitespace
  const tags = rawTags ? rawTags.split(",").map(t => t.trim()).filter(t => t.length > 0) : [];
  const currentDate = new Date().toISOString().split('T')[0];

  // 1. Detail JSON structure
  const detailObj = {
    id: projId,
    name: projName,
    description: projDesc,
    author: projAuthor,
    createdAt: currentDate,
    updatedAt: currentDate,
    tags: tags,
    category: projCategory,
    license: projLicense,
    githubLink: projGithub,
    websiteLink: projWeb,
    image: projImage || undefined,
    stats: {
      likes: 0,
      views: 0,
      comments: 0,
      bookmarks: 0
    },
    content: projContent
  };

  // 2. Index Entry JSON structure
  const indexObj = {
    id: projId,
    name: projName,
    description: projDesc,
    author: projAuthor,
    createdAt: currentDate,
    tags: tags,
    category: projCategory,
    stats: {
      likes: 0,
      views: 0,
      comments: 0,
      bookmarks: 0
    }
  };

  const detailBox = document.getElementById("detail-json-box");
  const indexBox = document.getElementById("index-json-box");

  if (detailBox) detailBox.value = JSON.stringify(detailObj, null, 2);
  if (indexBox) indexBox.value = JSON.stringify(indexObj, null, 2) + ",";
}

function renderVerificationPendingPage() {
  appContainer.innerHTML = `
    <div class="error-msg">
      <h3>이메일 인증 대기 중</h3>
      <p>이메일 인증을 완료해야 서비스를 이용할 수 있습니다. 가입하신 이메일의 메일함을 확인해 주세요.</p>
      <button class="btn" onclick="location.reload()" style="margin-top: 15px;">새로고침 (인증 확인)</button>
    </div>
  `;
}

// 5. 404 Page
function render404() {
  appContainer.innerHTML = `
    <div class="error-msg">
      <h3>404 - Page Not Found</h3>
      <p>요청하신 주소에 해당하는 페이지를 찾을 수 없습니다.</p>
      <a href="#/" class="btn" style="margin-top: 15px; display: inline-block;">피드로 돌아가기</a>
    </div>
  `;
}
