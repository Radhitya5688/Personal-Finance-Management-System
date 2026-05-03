(function () {
  const STORE_KEY = 'pfms_users';
  const SESSION_KEY = 'pfms_current_user';

  const pages = {
    '/login.html': initLogin,
    '/register.html': initRegister,
    '/dashboard.html': initDashboard,
    '/transactions.html': initTransactions,
    '/budget.html': initBudget,
    '/savings.html': initSavings,
    '/reports.html': initReports
  };

  document.addEventListener('DOMContentLoaded', () => {
    const page = location.pathname.substring(location.pathname.lastIndexOf('/')) || '/index.html';
    const init = pages[page];
    if (init) init();
  });

  function getUsers() {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
  }

  function saveUsers(users) {
    localStorage.setItem(STORE_KEY, JSON.stringify(users));
  }

  function getCurrentUser() {
    const email = localStorage.getItem(SESSION_KEY);
    if (!email) return null;
    return getUsers().find(user => user.email === email) || null;
  }

  function updateCurrentUser(mutator) {
    const email = localStorage.getItem(SESSION_KEY);
    const users = getUsers();
    const index = users.findIndex(user => user.email === email);
    if (index === -1) return null;
    mutator(users[index]);
    saveUsers(users);
    return users[index];
  }

  function requireAuth() {
    const user = getCurrentUser();
    if (!user) {
      window.location.href = 'login.html';
      return null;
    }
    document.querySelectorAll('[data-page]').forEach(link => {
      if (location.pathname.toLowerCase().includes(link.dataset.page)) link.classList.add('active');
    });
    const pill = document.getElementById('userPill');
    if (pill) pill.textContent = user.name;
    const logout = document.getElementById('logoutBtn');
    if (logout) {
      logout.addEventListener('click', () => {
        localStorage.removeItem(SESSION_KEY);
        window.location.href = 'login.html';
      });
    }
    return user;
  }

  function initLogin() {
    const form = document.getElementById('loginForm');
    form.addEventListener('submit', event => {
      event.preventDefault();
      const email = document.getElementById('loginEmail').value.trim().toLowerCase();
      const password = document.getElementById('loginPassword').value;
      const user = getUsers().find(item => item.email === email && item.password === password);
      if (!user) return showMessage('authMessage', 'Invalid email or password.');
      localStorage.setItem(SESSION_KEY, user.email);
      window.location.href = 'dashboard.html';
    });
  }

  function initRegister() {
    const form = document.getElementById('registerForm');
    form.addEventListener('submit', event => {
      event.preventDefault();
      const users = getUsers();
      const email = document.getElementById('registerEmail').value.trim().toLowerCase();
      if (users.some(user => user.email === email)) return showMessage('authMessage', 'Email already registered.');
      const balance = Number(document.getElementById('registerBalance').value);
      const user = {
        id: createId(),
        name: document.getElementById('registerName').value.trim(),
        email,
        password: document.getElementById('registerPassword').value,
        initialBalance: balance,
        transactions: [],
        budgets: [],
        goals: []
      };
      users.push(user);
      saveUsers(users);
      localStorage.setItem(SESSION_KEY, user.email);
      window.location.href = 'dashboard.html';
    });
  }

  function initDashboard() {
    const user = requireAuth();
    if (!user) return;
    const summary = calculateSummary(user);
    setText('currentBalance', money(summary.balance));
    setText('totalIncome', money(summary.income));
    setText('totalExpense', money(summary.expense));
    setText('totalSavings', money(summary.savings));
    renderRecentTransactions(user.transactions);
    renderFinanceChart(summary);
  }

  function initTransactions() {
    const user = requireAuth();
    if (!user) return;
    const date = document.getElementById('transactionDate');
    date.valueAsDate = new Date();
    document.getElementById('transactionBalance').textContent = money(calculateSummary(user).balance);
    renderTransactions(user.transactions);
    document.getElementById('transactionForm').addEventListener('submit', event => {
      event.preventDefault();
      const transaction = {
        id: createId(),
        type: document.getElementById('transactionType').value,
        category: normalizeCategory(document.getElementById('transactionCategory').value),
        amount: Number(document.getElementById('transactionAmount').value),
        date: document.getElementById('transactionDate').value,
        description: document.getElementById('transactionDescription').value.trim()
      };
      updateCurrentUser(current => current.transactions.push(transaction));
      event.target.reset();
      date.valueAsDate = new Date();
      const updated = getCurrentUser();
      document.getElementById('transactionBalance').textContent = money(calculateSummary(updated).balance);
      renderTransactions(updated.transactions);
      showMessage('transactionMessage', 'Transaction saved from your entry.');
    });
  }

  function initBudget() {
    const user = requireAuth();
    if (!user) return;
    renderBudgets(user);
    document.getElementById('budgetForm').addEventListener('submit', event => {
      event.preventDefault();
      const budget = {
        id: createId(),
        category: normalizeCategory(document.getElementById('budgetCategory').value),
        limit: Number(document.getElementById('budgetLimit').value)
      };
      updateCurrentUser(current => current.budgets.push(budget));
      event.target.reset();
      renderBudgets(getCurrentUser());
      showMessage('budgetMessage', 'Budget linked to matching expense transactions.');
    });
  }

  function initSavings() {
    const user = requireAuth();
    if (!user) return;
    renderSavings(user);
    document.getElementById('savingsForm').addEventListener('submit', event => {
      event.preventDefault();
      const goal = {
        id: createId(),
        name: document.getElementById('goalName').value.trim(),
        target: Number(document.getElementById('goalTarget').value),
        saved: Number(document.getElementById('goalSaved').value)
      };
      updateCurrentUser(current => current.goals.push(goal));
      event.target.reset();
      renderSavings(getCurrentUser());
      showMessage('savingsMessage', 'Savings goal added from your values.');
    });
  }

  function initReports() {
    const user = requireAuth();
    if (!user) return;
    const summary = calculateSummary(user);
    const incomes = user.transactions.filter(item => item.type === 'income');
    const expenses = user.transactions.filter(item => item.type === 'expense');
    const largest = expenses.reduce((max, item) => Math.max(max, item.amount), 0);
    setText('incomeCount', incomes.length);
    setText('expenseCount', expenses.length);
    setText('largestExpense', money(largest));
    setText('netResult', money(summary.income - summary.expense));
    renderCategoryReport(user);
    renderSummaryTable(user);
  }

  function calculateSummary(user) {
    const income = user.transactions.filter(item => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
    const expense = user.transactions.filter(item => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
    const savings = user.goals.reduce((sum, goal) => sum + goal.saved, 0);
    return {
      income,
      expense,
      savings,
      balance: Number(user.initialBalance || 0) + income - expense
    };
  }

  function renderTransactions(transactions) {
    const body = document.getElementById('transactionTable');
    if (!transactions.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">No transactions yet. Add your first income or expense.</td></tr>';
      return;
    }
    body.innerHTML = sortByDate(transactions).map(item => `
      <tr>
        <td>${escapeHtml(item.date)}</td>
        <td><span class="tag ${item.type}">${item.type}</span></td>
        <td>${escapeHtml(item.category)}</td>
        <td>${money(item.amount)}</td>
        <td><button class="danger-btn" data-delete-transaction="${item.id}">Delete</button></td>
      </tr>
    `).join('');
    body.querySelectorAll('[data-delete-transaction]').forEach(button => {
      button.addEventListener('click', () => {
        updateCurrentUser(user => {
          user.transactions = user.transactions.filter(item => item.id !== button.dataset.deleteTransaction);
        });
        const updated = getCurrentUser();
        document.getElementById('transactionBalance').textContent = money(calculateSummary(updated).balance);
        renderTransactions(updated.transactions);
      });
    });
  }

  function renderRecentTransactions(transactions) {
    const body = document.getElementById('recentTransactions');
    const recent = sortByDate(transactions).slice(0, 6);
    if (!recent.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty-state">No transaction data available yet.</td></tr>';
      return;
    }
    body.innerHTML = recent.map(item => `
      <tr>
        <td>${escapeHtml(item.date)}</td>
        <td><span class="tag ${item.type}">${item.type}</span></td>
        <td>${escapeHtml(item.category)}</td>
        <td>${money(item.amount)}</td>
      </tr>
    `).join('');
  }

  function renderBudgets(user) {
    const list = document.getElementById('budgetList');
    if (!user.budgets.length) {
      list.innerHTML = '<article class="progress-card empty-state">No budgets created yet.</article>';
      return;
    }
    list.innerHTML = user.budgets.map(budget => {
      const used = user.transactions
        .filter(item => item.type === 'expense' && sameCategory(item.category, budget.category))
        .reduce((sum, item) => sum + item.amount, 0);
      const percent = budget.limit ? Math.min((used / budget.limit) * 100, 100) : 0;
      const warning = percent >= 80;
      return `
        <article class="progress-card">
          <h3>${escapeHtml(budget.category)}</h3>
          <div class="progress-meta">
            <span>${money(used)} used</span>
            <span>${money(budget.limit)} limit</span>
          </div>
          <div class="progress-track"><div class="progress-fill ${warning ? 'warn' : ''}" style="width:${percent}%"></div></div>
          ${warning ? '<p class="alert">Alert: this category is nearing or crossing the budget limit.</p>' : ''}
        </article>
      `;
    }).join('');
  }

  function renderSavings(user) {
    const list = document.getElementById('savingsList');
    if (!user.goals.length) {
      list.innerHTML = '<article class="progress-card empty-state">No savings goals created yet.</article>';
      return;
    }
    list.innerHTML = user.goals.map(goal => {
      const percent = goal.target ? Math.min((goal.saved / goal.target) * 100, 100) : 0;
      return `
        <article class="progress-card">
          <h3>${escapeHtml(goal.name)}</h3>
          <div class="progress-meta">
            <span>${money(goal.saved)} saved</span>
            <span>${money(goal.target)} target</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
        </article>
      `;
    }).join('');
  }

  function renderCategoryReport(user) {
    const target = document.getElementById('categoryReport');
    const expenses = groupByCategory(user.transactions.filter(item => item.type === 'expense'));
    const total = Object.values(expenses).reduce((sum, value) => sum + value, 0);
    if (!total) {
      target.innerHTML = '<p class="empty-state">No expense data available for reports.</p>';
      return;
    }
    target.innerHTML = Object.entries(expenses).map(([category, amount]) => {
      const percent = (amount / total) * 100;
      return `
        <div class="report-row">
          <div class="progress-meta"><span>${escapeHtml(category)}</span><span>${money(amount)}</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
        </div>
      `;
    }).join('');
  }

  function renderSummaryTable(user) {
    const body = document.getElementById('summaryTable');
    const categories = [...new Set(user.transactions.map(item => item.category))];
    if (!categories.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty-state">Reports will appear after transactions are entered.</td></tr>';
      return;
    }
    body.innerHTML = categories.map(category => {
      const income = user.transactions.filter(item => item.type === 'income' && sameCategory(item.category, category)).reduce((sum, item) => sum + item.amount, 0);
      const expense = user.transactions.filter(item => item.type === 'expense' && sameCategory(item.category, category)).reduce((sum, item) => sum + item.amount, 0);
      return `<tr><td>${escapeHtml(category)}</td><td>${money(income)}</td><td>${money(expense)}</td><td>${money(income - expense)}</td></tr>`;
    }).join('');
  }

  function renderFinanceChart(summary) {
    const canvas = document.getElementById('financeChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const values = [
      { label: 'Income', amount: summary.income, color: '#61a88f' },
      { label: 'Expenses', amount: summary.expense, color: '#c77858' },
      { label: 'Savings', amount: summary.savings, color: '#d3a94d' }
    ];
    const max = Math.max(...values.map(item => item.amount), 1);
    const barWidth = Math.max(42, width / values.length - 42);
    values.forEach((item, index) => {
      const x = index * (width / values.length) + 22;
      const barHeight = (item.amount / max) * (height - 78);
      const y = height - 42 - barHeight;
      ctx.fillStyle = item.color;
      roundRect(ctx, x, y, barWidth, barHeight, 8);
      ctx.fill();
      ctx.fillStyle = '#1e2b28';
      ctx.font = '700 13px Segoe UI, Arial';
      ctx.fillText(item.label, x, height - 18);
      ctx.fillStyle = '#6f7d77';
      ctx.font = '700 12px Segoe UI, Arial';
      ctx.fillText(money(item.amount), x, Math.max(18, y - 10));
    });
  }

  function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function groupByCategory(items) {
    return items.reduce((groups, item) => {
      groups[item.category] = (groups[item.category] || 0) + item.amount;
      return groups;
    }, {});
  }

  function sortByDate(items) {
    return [...items].sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function normalizeCategory(value) {
    return value.trim().replace(/\s+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function sameCategory(a, b) {
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `pfms-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function money(value) {
    return `Rs ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function showMessage(id, text) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = text;
    window.setTimeout(() => { element.textContent = ''; }, 2600);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
})();
