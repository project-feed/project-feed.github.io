/* ==========================================================================
   Project-feed Core Frontend Engine (app.js)
   ========================================================================== */

// Import Firebase initialized instances
import { auth, db } from './config/firebase.js';
import {
  signInWithPopup,
  GithubAuthProvider,
  signOut
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
  const icon = document.getElementById("theme-icon");
  const text = document.getElementById("theme-text");
  
  if (icon && text) {
    if (theme === "dark") {
      icon.textContent = "◆";
      text.textContent = "LIGHT";
    } else {
      icon.textContent = "◇";
      text.textContent = "DARK";
    }
  }
}

// Add global listener for dynamic theme buttons
document.addEventListener("click", (e) => {
  if (e.target.closest("#theme-toggle-btn")) {
    toggleTheme();
  }
});

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

const GITHUB_REPO_OWNER = "project-feed";
const GITHUB_REPO_NAME = "project-feed.github.io";

async function fetchGraphQL(query, variables = {}) {
  const token = localStorage.getItem("github_token");
  if (!token) throw new Error("No GitHub token found. Please login.");

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Authorization": `bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  
  const result = await response.json();
  if (result.errors) {
    console.error("GraphQL Errors:", result.errors);
    throw new Error(result.errors[0].message);
  }
  return result.data;
}

async function loadInitialData() {
  try {
// Ensure categories are loaded from custom JSON (projectCategories.json)
    // This data defines the hierarchical categories used for filtering projects.
    // It is independent of GitHub discussion categories.
    // Example structure: [{id, name, subcategories: []}, ...]
    const customCatData = await fetchJSON('projectCategories.json').catch(() => []);
    state.customCategories = customCatData || [];
    // Default filter values
    state.selectedCustomCategory = 'ALL';
    state.selectedCustomSubcategory = 'ALL';
    // Fetch discussions from the repository
    const query = `
      query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          id
          discussionCategories(first: 10) {
            nodes {
              id
              name
            }
          }
          discussions(first: 50, orderBy: {field: CREATED_AT, direction: DESC}) {
            nodes {
              id
              number
              title
              body
              createdAt
              updatedAt
              author {
                login
                avatarUrl
              }
              category {
                name
              }
              labels(first: 5) {
                nodes {
                  name
                }
              }
              upvoteCount
              comments {
                totalCount
              }
            }
          }
        }
      }
    `;
    const data = await fetchGraphQL(query, { owner: GITHUB_REPO_OWNER, name: GITHUB_REPO_NAME });
    
    state.repoId = data.repository.id;
    state.discussionCategories = data.repository.discussionCategories.nodes || [];
    
    state.projectsCategory = state.discussionCategories.find(c => c.name.toLowerCase() === 'projects');
    state.usersCategory = state.discussionCategories.find(c => c.name.toLowerCase() === 'users');

    const discussions = data.repository.discussions.nodes || [];

    const mappedDiscussions = discussions.map(d => {
      // Parse custom category and subcategory from discussion body (if present)
      let customCategory = 'ALL';
      let customSubcategory = 'ALL';
      const categoryMatch = d.body.match(/^Category:\s*(.+)$/m);
      if (categoryMatch) customCategory = categoryMatch[1].trim();
      const subcatMatch = d.body.match(/^Subcategory:\s*(.+)$/m);
      if (subcatMatch) customSubcategory = subcatMatch[1].trim();

      // Simple hashtag parsing for custom tags (e.g. #Web #Mobile)
      const hashtagRegex = /#([\w가-힣]+)/g;
      const foundTags = [...d.body.matchAll(hashtagRegex)].map(match => match[1]);
      const uniqueTags = [...new Set([...d.labels.nodes.map(l => l.name), ...foundTags])];

      return {
        id: d.number.toString(), // Use issue/discussion number as ID
        name: d.title,
        description: d.body.substring(0, 150) + (d.body.length > 150 ? '...' : ''), // Preview
        content: d.body,
        category: d.category.name,
        customCategory,
        customSubcategory,
        tags: uniqueTags,
        author: d.author.login,
        authorAvatar: d.author.avatarUrl,
        createdAt: d.createdAt.split('T')[0],
        updatedAt: d.updatedAt.split('T')[0],
        stats: {
          likes: d.upvoteCount,
          views: 0,
          bookmarks: 0,
          comments: d.comments.totalCount
        }
      };
    });

    state.projects = mappedDiscussions.filter(d => d.category.toLowerCase() === 'projects');
    state.userProfiles = mappedDiscussions.filter(d => d.category.toLowerCase() === 'users');

    // Auto-create profile if missing
    if (state.currentUser && state.usersCategory) {
      const username = (state.currentUser.reloadUserInfo && state.currentUser.reloadUserInfo.screenName) || state.currentUser.email?.split('@')[0];
      const existingProfile = state.userProfiles.find(p => p.author === username);
      
      if (!existingProfile) {
        // Run in background
        createDiscussion(state.usersCategory.id, `${username}의 프로필`, `안녕하세요! ${username}입니다.\n\n#profile`)
          .then(() => console.log("자동 프로필 생성 완료!"))
          .catch(e => console.error("자동 프로필 생성 실패:", e));
      } else if (state.userProfile) {
        state.userProfile.bio = existingProfile.content;
      }
    }
  } catch (error) {
    appContainer.innerHTML = `
      <div class="error-msg" style="text-align: center; margin-top: 50px;">
        <h3>데이터를 불러올 수 없습니다</h3>
        <p>${error.message}</p>
        <p>GitHub 로그인이 필요하거나 권한이 없습니다.</p>
        <a href="#/login" class="btn" style="margin-top: 15px; display: inline-block;">로그인 페이지로 이동</a>
      </div>
    `;
    throw error;
  }
}

async function createDiscussion(categoryId, title, body) {
  if (!state.repoId) throw new Error("레포지토리 ID를 찾을 수 없습니다.");
  const query = `
    mutation($repoId: ID!, $catId: ID!, $title: String!, $body: String!) {
      createDiscussion(input: {repositoryId: $repoId, categoryId: $catId, title: $title, body: $body}) {
        discussion {
          number
        }
      }
    }
  `;
  const data = await fetchGraphQL(query, { repoId: state.repoId, catId: categoryId, title, body });
  return data.createDiscussion.discussion.number;
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

  // Routing Matches that don't need initial data
  if (routes.login.test(hash)) {
    if (loginLink) loginLink.classList.add("active");
    renderLoginPage();
    return;
  }

  // Load database index if not loaded
  if (state.projects.length === 0) {
    try {
      await loadInitialData();
    } catch (e) {
      // Error message is already rendered by loadInitialData
      return; 
    }
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

    if (state.currentUser) {
      container.innerHTML = `
        <div class="dropdown">
          <a href="#/user/${escapeHTML(username)}" class="user-menu-btn" id="header-profile-link">
            <img src="${escapeHTML(avatar)}" width="20" height="20">
            <span>${escapeHTML(nickname)}</span>
          </a>
          <div class="dropdown-menu">
            <a href="#/profile/edit" class="dropdown-item">Edit Profile</a>
            <button class="dropdown-item" id="theme-toggle-btn">
              <span id="theme-icon">◇</span> <span id="theme-text">DARK</span>
            </button>
            <button class="dropdown-item" id="logout-btn">Logout</button>
          </div>
        </div>
      `;
      // Update theme UI immediately for the new button
      updateThemeUI(document.documentElement.getAttribute("data-theme") || "light");
    }

    // Bind logout
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", handleLogout);
    }
  } else {
    // Guest
    container.innerHTML = `
      <div class="dropdown">
        <button class="user-menu-btn">Guest</button>
        <div class="dropdown-menu">
          <a href="#/login" class="dropdown-item" id="nav-login">Login</a>
          <button class="dropdown-item" id="theme-toggle-btn">
            <span id="theme-icon">◇</span> <span id="theme-text">DARK</span>
          </button>
        </div>
      </div>
    `;
    updateThemeUI(document.documentElement.getAttribute("data-theme") || "light");
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    localStorage.removeItem("github_token");
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
    // Attempt to load profile if available, otherwise just use auth info
    const username = (user.reloadUserInfo && user.reloadUserInfo.screenName) || user.email?.split('@')[0] || "user";
    try {
      const profile = await fetchJSON(`./users/${username}.json`).catch(() => null);
      state.userProfile = profile || { username, avatar: user.photoURL };
    } catch (e) {
      console.error('User profile JSON load failed:', e);
      state.userProfile = { username, avatar: user.photoURL };
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

// 2. 로그인 페이지 렌더링
function renderLoginPage() {
  appContainer.innerHTML = `
    <div class="login-page" style="text-align: center; max-width: 400px; margin: 60px auto;">
      <h2 class="login-title">로그인</h2>
      <p style="margin-bottom: 30px; font-size: 14px; color: var(--text-color); opacity: 0.8;">
        Project-feed는 GitHub 연동을 통해서만 이용하실 수 있습니다.<br>
        모든 프로젝트와 댓글은 GitHub Discussions에 동기화됩니다.
      </p>
      <button class="btn" id="github-login-btn" style="width: 100%; height: 48px; font-size: 16px;">
        <svg height="20" viewBox="0 0 16 16" version="1.1" width="20" style="vertical-align: middle; margin-right: 10px;"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>
        Login with GitHub
      </button>
      <div id="login-error" class="error-msg" style="margin-top:20px;"></div>
    </div>
  `;

  document.getElementById('github-login-btn').addEventListener('click', async () => {
    const errorDiv = document.getElementById('login-error');
    errorDiv.textContent = '';
    
    const provider = new GithubAuthProvider();
    provider.addScope('public_repo');
    
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GithubAuthProvider.credentialFromResult(result);
      if (credential && credential.accessToken) {
        localStorage.setItem("github_token", credential.accessToken);
      }
      router();
    } catch (e) {
      console.error('GitHub Login failed:', e);
      errorDiv.textContent = '로그인 실패: ' + e.message;
    }
  });
}

// 3. 프로젝트 제출 페이지 (Submit Page)
function renderSubmitPage() {
  // Ensure custom categories are loaded
  if (!state.customCategories || state.customCategories.length === 0) {
    loadInitialData().then(() => renderSubmitPage()).catch(err => {
      appContainer.innerHTML = `<div class="error-msg" style="text-align:center; margin-top:50px;"><h3>카테고리 로드 실패</h3><p>${err.message}</p></div>`;
    });
    return;
  }

  // Build main category options
  const customOptions = state.customCategories.map(cat => {
    return `<option value="${escapeHTML(cat.name)}">${escapeHTML(cat.icon || '')} ${escapeHTML(cat.name)}</option>`;
  }).join('');

  // Get subcategories for first category by default
  const firstCat = state.customCategories[0];
  const firstSubOptions = (firstCat && firstCat.subcategories && firstCat.subcategories.length)
    ? firstCat.subcategories.map(s => `<option value="${escapeHTML(s.name)}">${escapeHTML(s.name)}</option>`).join('')
    : '<option value="">해당 없음</option>';

  appContainer.innerHTML = `
    <div class="submit-container">
      <div class="submit-header">
        <h2 class="submit-title">새 프로젝트 등록</h2>
        <p class="submit-subtitle">등록한 프로젝트는 GitHub Discussions의 Projects 카테고리에 자동으로 생성됩니다.</p>
      </div>
      <form id="submit-form" class="submit-form">
        <div class="form-row" style="display:flex; gap:16px;">
          <div class="form-group" style="flex:1;">
            <label class="form-label" for="custom-category-select">카테고리</label>
            <select class="form-control" id="custom-category-select">${customOptions}</select>
          </div>
          <div class="form-group" style="flex:1;">
            <label class="form-label" for="custom-subcategory-select">세부 카테고리</label>
            <select class="form-control" id="custom-subcategory-select">${firstSubOptions}</select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="project-title">프로젝트 이름</label>
          <input type="text" class="form-control" id="project-title" placeholder="멋진 프로젝트 이름을 적어주세요." required>
        </div>
        <div class="form-group">
          <label class="form-label" for="proj-tags">태그 (쉼표로 구분)</label>
          <input type="text" class="form-control" id="proj-tags" placeholder="예: React, Python, 오픈소스">
        </div>
        <div class="form-group">
          <label class="form-label" for="project-body">프로젝트 설명 (Markdown 지원)</label>
          <textarea class="form-control" id="project-body" rows="10" placeholder="# 프로젝트 개요&#10;&#10;상세한 설명을 마크다운으로 작성해주세요." required></textarea>
        </div>
        <button type="submit" class="btn" id="submit-btn" style="width:100%; height:48px; font-size:16px; margin-top:8px;">게시하기</button>
        <div id="submit-error" class="error-msg" style="margin-top:12px;"></div>
      </form>
    </div>
  `;

  // Update subcategory options when main category changes
  const catSelect = document.getElementById('custom-category-select');
  const subSelect = document.getElementById('custom-subcategory-select');
  catSelect.addEventListener('change', () => {
    const selected = state.customCategories.find(c => c.name === catSelect.value);
    if (selected && selected.subcategories && selected.subcategories.length) {
      subSelect.innerHTML = selected.subcategories.map(s => `<option value="${escapeHTML(s.name)}">${escapeHTML(s.name)}</option>`).join('');
    } else {
      subSelect.innerHTML = '<option value="">해당 없음</option>';
    }
  });

  document.getElementById('submit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('project-title').value.trim();
    const body = document.getElementById('project-body').value.trim();
    const tags = document.getElementById('proj-tags').value.trim();
    const selectedCustomCategory = catSelect.value;
    const selectedSubcategory = subSelect.value;
    const errorDiv = document.getElementById('submit-error');
    const btn = document.getElementById('submit-btn');
    errorDiv.textContent = '';

    if (!title || !body) {
      errorDiv.textContent = "제목과 설명을 모두 입력해주세요.";
      return;
    }
    if (!state.projectsCategory) {
      errorDiv.textContent = "Projects 카테고리를 찾을 수 없습니다.";
      return;
    }

    // Build body: prepend Category metadata, append hashtags
    let finalBody = `Category: ${selectedCustomCategory}\nSubcategory: ${selectedSubcategory}\n\n${body}`;
    if (tags) {
      const hashtagStr = tags.split(',').map(t => '#' + t.trim()).join(' ');
      finalBody += `\n\n---\n${hashtagStr}`;
    }

    try {
      btn.textContent = "게시 중...";
      btn.disabled = true;
      const discussionNumber = await createDiscussion(state.projectsCategory.id, title, finalBody);
      state.projects = []; // clear cache
      window.location.hash = `#/project/${discussionNumber}`;
    } catch (err) {
      errorDiv.textContent = "등록 실패: " + err.message;
      btn.textContent = "게시하기";
      btn.disabled = false;
    }
  });
}

// ==========================================================================
// Page Renderers (Sidebar and Lists)
// ===========================================================================
function updateSidebarUI() {
  const categoryFilterList = document.getElementById("category-filter-list");
  const tagCloudList = document.getElementById("tag-cloud-list");
  
  if (!categoryFilterList || !tagCloudList) return;

  // Build custom categories filter with hierarchy
  const cats = state.customCategories || [];
  const allCount = state.projects.length;

  let catHTML = `
    <button class="filter-btn ${state.selectedCustomCategory === 'ALL' ? 'active' : ''}" data-category="ALL" data-subcategory="ALL">
      <span>🗂️ 전체</span>
      <span class="count">${allCount}</span>
    </button>
  `;

  cats.forEach(cat => {
    const catCount = state.projects.filter(p => p.customCategory === cat.name).length;
    const isCatActive = state.selectedCustomCategory === cat.name && state.selectedCustomSubcategory === 'ALL';
    catHTML += `
      <button class="filter-btn filter-btn-parent ${isCatActive ? 'active' : ''}" data-category="${escapeHTML(cat.name)}" data-subcategory="ALL">
        <span>${escapeHTML(cat.icon || '')} ${escapeHTML(cat.name)}</span>
        <span class="count">${catCount}</span>
      </button>
    `;
    if (cat.subcategories && cat.subcategories.length) {
      cat.subcategories.forEach(sub => {
        const subCount = state.projects.filter(p => p.customCategory === cat.name && p.customSubcategory === sub.name).length;
        const isSubActive = state.selectedCustomCategory === cat.name && state.selectedCustomSubcategory === sub.name;
        catHTML += `
          <button class="filter-btn filter-btn-child ${isSubActive ? 'active' : ''}" data-category="${escapeHTML(cat.name)}" data-subcategory="${escapeHTML(sub.name)}">
            <span>↳ ${escapeHTML(sub.name)}</span>
            <span class="count">${subCount}</span>
          </button>
        `;
      });
    }
  });

  categoryFilterList.innerHTML = catHTML;

  // Attach click events for custom categories
  categoryFilterList.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedCustomCategory = btn.getAttribute('data-category');
      state.selectedCustomSubcategory = btn.getAttribute('data-subcategory') || 'ALL';
      categoryFilterList.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectedTag = 'ALL';
      updateProjectsList();
    });
  });

  // Tags listing
  const tagCounts = {};
  state.projects.forEach(p => {
    if (p.tags && Array.isArray(p.tags)) {
      p.tags.forEach(t => {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });
    }
  });

  const sortedTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);

  tagCloudList.innerHTML = `
    <button class="tag-btn ${state.selectedTag === 'ALL' ? 'active' : ''}" data-tag="ALL">#all</button>
    ${sortedTags.map(tag => `
      <button class="tag-btn ${state.selectedTag === tag ? 'active' : ''}" data-tag="${escapeHTML(tag)}">#${escapeHTML(tag)}</button>
    `).join("")}
  `;

  tagCloudList.querySelectorAll(".tag-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedTag = btn.getAttribute("data-tag");
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
    // Category filter (custom)
    if (state.selectedCustomCategory && state.selectedCustomCategory !== 'ALL') {
      if (p.customCategory !== state.selectedCustomCategory) return false;
      if (state.selectedCustomSubcategory && state.selectedCustomSubcategory !== 'ALL') {
        if (p.customSubcategory !== state.selectedCustomSubcategory) return false;
      }
    }
    // Tag filter
    if (state.selectedTag !== 'ALL' && (!p.tags || !p.tags.includes(state.selectedTag))) {
      return false;
    }
    // Search query
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
                <span class="stat-item">💬 ${(p.stats && p.stats.comments) || 0}</span>
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



function renderVerificationPendingPage() {
  appContainer.innerHTML = `
    <div class="error-msg">
      <h3>권한 대기 중</h3>
      <p>현재 계정 상태를 확인하고 있습니다. 잠시 후 다시 시도해주세요.</p>
      <button class="btn" onclick="location.reload()" style="margin-top: 15px;">새로고침</button>
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
