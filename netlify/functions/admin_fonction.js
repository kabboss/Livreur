/**
 * SEND2.0 Pro - Système d'Administration Ultra-Avancé
 * Gestionnaire principal pour l'interface d'administration
 */

class AdminManager {
    constructor() {
        this.API_URL = 'https://send20.netlify.app/.netlify/functions/admin_fonction';
        this.currentView = 'dashboard';
        this.currentCollection = null;
        this.currentPage = 1;
        this.itemsPerPage = 20;
        this.selectedItems = new Set();
        this.currentData = [];
        this.currentFilters = {};
        this.searchDebounceTimer = null;
        this.autoRefreshInterval = null;
        this.init();
    }

    init() {
        console.log('🚀 Initialisation du système d\'administration');
        this.setupEventListeners();
        this.loadDashboard();
        this.startAutoRefresh();
        this.setupTheme();
        console.log('✅ Système d\'administration initialisé');
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const view = item.dataset.view;
                const collection = item.dataset.collection;
                
                if (view) {
                    this.switchView(view);
                } else if (collection) {
                    this.loadCollection(collection);
                }
            });
        });

        // Recherche globale
        const globalSearch = document.getElementById('globalSearch');
        if (globalSearch) {
            globalSearch.addEventListener('input', (e) => {
                this.debounce(() => this.handleGlobalSearch(e.target.value), 500)();
            });
        }

        // Recherche dans les vues
        ['searchLivreurs', 'searchRestaurants', 'searchCollection'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('input', (e) => {
                    this.debounce(() => this.handleViewSearch(e.target.value), 500)();
                });
            }
        });

        // Gestion du redimensionnement
        window.addEventListener('resize', () => this.handleResize());

        // Fermeture des modales avec Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });

        // Prévenir la fermeture accidentelle
        window.addEventListener('beforeunload', (e) => {
            if (this.hasUnsavedChanges()) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    // ===== NAVIGATION =====

    switchView(viewName) {
        // Masquer toutes les vues
        document.querySelectorAll('.view').forEach(view => {
            view.classList.remove('active');
        });

        // Afficher la vue demandée
        const targetView = document.getElementById(viewName + 'View');
        if (targetView) {
            targetView.classList.add('active');
            this.currentView = viewName;
            
            // Mettre à jour la navigation
            this.updateActiveNavigation(viewName);
            
            // Charger les données de la vue
            this.loadViewData(viewName);
            
            // Fermer la sidebar sur mobile
            if (window.innerWidth < 768) {
                this.closeSidebar();
            }
        }
    }

    updateActiveNavigation(viewName) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const activeItem = document.querySelector(`[data-view="${viewName}"]`);
        if (activeItem) {
            activeItem.classList.add('active');
        }
    }

    loadViewData(viewName) {
        switch(viewName) {
            case 'dashboard':
                this.loadDashboard();
                break;
            case 'demandes-livreurs':
                this.loadDemandesLivreurs();
                break;
            case 'demandes-restaurants':
                this.loadDemandesRestaurants();
                break;
            case 'analytics':
                this.loadAnalytics();
                break;
            case 'settings':
                this.loadSettings();
                break;
        }
    }

    // ===== DASHBOARD =====

    async loadDashboard() {
        try {
            this.showLoading('Chargement du tableau de bord...');
            
            const response = await this.apiCall('getStats');
            
            if (response.success) {
                this.displayDashboardStats(response);
                this.loadRecentActivity();
                this.updateNotificationBadges(response);
            } else {
                this.showToast('Erreur', 'error', 'Impossible de charger le tableau de bord');
            }
        } catch (error) {
            console.error('❌ Erreur dashboard:', error);
            this.showToast('Erreur', 'error', 'Problème de connexion');
        } finally {
            this.hideLoading();
        }
    }

    displayDashboardStats(data) {
        const container = document.getElementById('statsGrid');
        const collections = data.collections || {};
        const demandes = data.demandes || {};

        const stats = [
            {
                title: 'Colis',
                value: collections.colis || 0,
                icon: 'fas fa-box',
                color: 'var(--primary)',
                description: 'Packages en cours',
                action: () => this.loadCollection('Colis')
            },
            {
                title: 'En Livraison',
                value: collections.livraison || 0,
                icon: 'fas fa-truck',
                color: 'var(--warning)',
                description: 'Livraisons actives',
                action: () => this.loadCollection('Livraison')
            },
            {
                title: 'Livrées',
                value: collections.livrees || 0,
                icon: 'fas fa-check-circle',
                color: 'var(--success)',
                description: 'Livraisons terminées',
                change: '+12%',
                positive: true,
                action: () => this.loadCollection('LivraisonsEffectuees')
            },
            {
                title: 'Livreurs Actifs',
                value: collections.livreurs || 0,
                icon: 'fas fa-users',
                color: 'var(--info)',
                description: 'Personnel disponible',
                action: () => this.loadCollection('Res_livreur')
            },
            {
                title: 'Restaurants',
                value: collections.restaurants || 0,
                icon: 'fas fa-utensils',
                color: 'var(--secondary)',
                description: 'Partenaires actifs',
                action: () => this.loadCollection('Restau')
            },
            {
                title: 'Demandes Livreurs',
                value: demandes.livreurs?.parStatut?.en_attente || 0,
                icon: 'fas fa-user-plus',
                color: 'var(--accent)',
                description: 'En attente de validation',
                action: () => this.switchView('demandes-livreurs')
            },
            {
                title: 'Demandes Restaurants',
                value: demandes.restaurants?.parStatut?.en_attente || 0,
                icon: 'fas fa-store',
                color: 'var(--danger)',
                description: 'En attente de validation',
                action: () => this.switchView('demandes-restaurants')
            },
            {
                title: 'Commandes',
                value: collections.commandes || 0,
                icon: 'fas fa-shopping-bag',
                color: 'var(--success)',
                description: 'Total des commandes',
                action: () => this.loadCollection('Commandes')
            }
        ];

        container.innerHTML = stats.map(stat => `
            <div class="stat-card" onclick="(${stat.action.toString()})()">
                <div class="stat-header">
                    <div class="stat-title">${stat.title}</div>
                    <div class="stat-icon" style="background: ${stat.color};">
                        <i class="${stat.icon}"></i>
                    </div>
                </div>
                <div class="stat-value">${this.formatNumber(stat.value)}</div>
                ${stat.change ? `
                    <div class="stat-change ${stat.positive ? 'positive' : 'negative'}">
                        <i class="fas fa-arrow-${stat.positive ? 'up' : 'down'}"></i>
                        ${stat.change}
                    </div>
                ` : `<div class="stat-change">${stat.description}</div>`}
            </div>
        `).join('');
    }

    loadRecentActivity() {
        // Simuler des données d'activité récente
        const activities = [
            {
                time: this.formatTime(new Date()),
                type: 'Livraison',
                description: 'Nouvelle livraison créée #LIV2024001',
                status: 'success'
            },
            {
                time: this.formatTime(new Date(Date.now() - 300000)),
                type: 'Demande',
                description: 'Nouvelle demande de livreur reçue',
                status: 'pending'
            },
            {
                time: this.formatTime(new Date(Date.now() - 600000)),
                type: 'Restaurant',
                description: 'Restaurant "Le Délice" approuvé',
                status: 'success'
            },
            {
                time: this.formatTime(new Date(Date.now() - 900000)),
                type: 'Colis',
                description: 'Colis #COL2024050 livré avec succès',
                status: 'success'
            }
        ];

        const tbody = document.getElementById('recentActivity');
        if (tbody) {
            tbody.innerHTML = activities.map(activity => `
                <tr>
                    <td>${activity.time}</td>
                    <td><span class="badge badge-${this.getActivityBadgeType(activity.type)}">${activity.type}</span></td>
                    <td>${activity.description}</td>
                    <td><span class="badge badge-${this.getStatusBadgeType(activity.status)}">${this.getStatusText(activity.status)}</span></td>
                </tr>
            `).join('');
        }
    }

    updateNotificationBadges(data) {
        const badges = {
            'badgeLivreurs': data.demandes?.livreurs?.parStatut?.en_attente || 0,
            'badgeRestaurants': data.demandes?.restaurants?.parStatut?.en_attente || 0,
            'badgeColis': data.collections?.colis || 0,
            'badgeLivraison': data.collections?.livraison || 0,
            'badgeLivrees': data.collections?.livrees || 0,
            'badgeResLivreur': data.collections?.livreurs || 0,
            'badgeRestau': data.collections?.restaurants || 0,
            'badgeCommandes': data.collections?.commandes || 0
        };

        Object.entries(badges).forEach(([id, count]) => {
            this.updateBadge(id, count);
        });

        // Badge de notification global
        const totalNotifications = 
            (data.demandes?.livreurs?.parStatut?.en_attente || 0) + 
            (data.demandes?.restaurants?.parStatut?.en_attente || 0);
        
        this.updateBadge('notificationBadge', totalNotifications);
    }

    // ===== GESTION DES DEMANDES =====

    async loadDemandesLivreurs(page = 1, filters = {}) {
        try {
            this.showLoading('Chargement des demandes de livreurs...');
            
            const response = await this.apiCall('getDemandesLivreurs', {
                statut: filters.status || document.getElementById('filterStatusLivreurs')?.value || '',
                search: filters.search || document.getElementById('searchLivreurs')?.value || '',
                limit: this.itemsPerPage,
                offset: (page - 1) * this.itemsPerPage
            });

            if (response.success) {
                this.currentData = response.data || [];
                this.displayDemandesLivreurs(response.data || []);
                this.displayPagination('paginationLivreurs', response.totalCount || 0, page, 'loadDemandesLivreurs');
                this.updateBadge('badgeLivreurs', response.stats?.en_attente || 0);
            } else {
                this.showToast('Erreur', 'error', response.message);
            }
        } catch (error) {
            console.error('❌ Erreur loadDemandesLivreurs:', error);
            this.showToast('Erreur', 'error', 'Impossible de charger les demandes');
        } finally {
            this.hideLoading();
        }
    }

    displayDemandesLivreurs(demandes) {
        const tbody = document.getElementById('bodyLivreurs');
        
        if (!demandes || demandes.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                        <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 1rem; display: block;"></i>
                        Aucune demande trouvée
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = demandes.map(demande => `
            <tr class="${this.selectedItems.has(demande._id) ? 'row-selected' : ''}" onclick="this.handleRowClick('${demande._id}', event)">
                <td class="checkbox-container">
                    <input type="checkbox" class="checkbox" 
                           ${this.selectedItems.has(demande._id) ? 'checked' : ''} 
                           onchange="adminManager.toggleItemSelection('${demande._id}', 'demandesLivreurs')"
                           onclick="event.stopPropagation()">
                </td>
                <td>${this.formatDate(demande.dateCreation)}</td>
                <td>
                    <div style="font-weight: 600;">${demande.nom || ''} ${demande.prenom || ''}</div>
                    ${demande.documents?.photoIdentite ? '<i class="fas fa-camera" style="color: var(--success); margin-left: 0.5rem;" title="Photo fournie"></i>' : ''}
                </td>
                <td>
                    <div style="font-family: monospace; color: var(--primary);">${demande.whatsapp || ''}</div>
                    ${demande.telephone ? `<small style="color: var(--text-secondary);">${demande.telephone}</small>` : ''}
                </td>
                <td>${demande.quartier || '-'}</td>
                <td>
                    <div>${demande.vehicule || '-'}</div>
                    ${demande.immatriculation ? `<small style="color: var(--text-secondary);">${demande.immatriculation}</small>` : ''}
                </td>
                <td>${this.getStatusBadge(demande.statut)}</td>
                <td onclick="event.stopPropagation();">
                    <div style="display: flex; gap: 0.25rem;">
                        ${this.getDemandeActions(demande._id, demande.statut, 'livreur')}
                        <button class="btn btn-xs btn-info" onclick="adminManager.showDemandeDetail('${demande._id}', 'livreur')" title="Voir détails">
                            <i class="fas fa-eye"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

        // Mettre à jour le compteur de sélection
        this.updateSelectionCount('demandesLivreurs');
    }

    async loadDemandesRestaurants(page = 1, filters = {}) {
        try {
            this.showLoading('Chargement des demandes de restaurants...');
            
            const response = await this.apiCall('getDemandesRestaurants', {
                statut: filters.status || document.getElementById('filterStatusRestaurants')?.value || '',
                search: filters.search || document.getElementById('searchRestaurants')?.value || '',
                limit: this.itemsPerPage,
                offset: (page - 1) * this.itemsPerPage
            });

            if (response.success) {
                this.currentData = response.data || [];
                this.displayDemandesRestaurants(response.data || []);
                this.displayPagination('paginationRestaurants', response.totalCount || 0, page, 'loadDemandesRestaurants');
                this.updateBadge('badgeRestaurants', response.stats?.en_attente || 0);
            } else {
                this.showToast('Erreur', 'error', response.message);
            }
        } catch (error) {
            console.error('❌ Erreur loadDemandesRestaurants:', error);
            this.showToast('Erreur', 'error', 'Impossible de charger les demandes');
        } finally {
            this.hideLoading();
        }
    }

    displayDemandesRestaurants(demandes) {
        const tbody = document.getElementById('bodyRestaurants');
        
        if (!demandes || demandes.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                        <i class="fas fa-store" style="font-size: 3rem; margin-bottom: 1rem; display: block;"></i>
                        Aucune demande trouvée
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = demandes.map(demande => `
            <tr class="${this.selectedItems.has(demande._id) ? 'row-selected' : ''}" onclick="this.handleRowClick('${demande._id}', event)">
                <td class="checkbox-container">
                    <input type="checkbox" class="checkbox" 
                           ${this.selectedItems.has(demande._id) ? 'checked' : ''} 
                           onchange="adminManager.toggleItemSelection('${demande._id}', 'demandesRestaurants')"
                           onclick="event.stopPropagation()">
                </td>
                <td>${this.formatDate(demande.dateCreation)}</td>
                <td>
                    <div style="font-weight: 600;">${demande.nom || ''}</div>
                    ${demande.nomCommercial ? `<small style="color: var(--text-secondary);">${demande.nomCommercial}</small>` : ''}
                    ${demande.logo ? '<i class="fas fa-image" style="color: var(--success); margin-left: 0.5rem;" title="Logo fourni"></i>' : ''}
                </td>
                <td>
                    <div style="font-family: monospace; color: var(--primary);">${demande.telephone || ''}</div>
                    ${demande.email ? `<small style="color: var(--text-secondary);">${demande.email}</small>` : ''}
                </td>
                <td>
                    <div>${demande.adresse || '-'}</div>
                    ${demande.quartier ? `<small style="color: var(--text-secondary);">${demande.quartier}</small>` : ''}
                </td>
                <td>${demande.cuisine || '-'}</td>
                <td>
                    ${demande.location ? 
                        `<i class="fas fa-map-marker-alt" style="color: var(--success);" title="GPS: ${demande.location.latitude.toFixed(4)}, ${demande.location.longitude.toFixed(4)}"></i>
                         <small style="display: block; color: var(--text-secondary);">±${Math.round(demande.location.accuracy || 0)}m</small>` : 
                        '<i class="fas fa-map-marker-alt" style="color: var(--danger);" title="Pas de GPS"></i>'
                    }
                </td>
                <td>${this.getStatusBadge(demande.statut)}</td>
                <td onclick="event.stopPropagation();">
                    <div style="display: flex; gap: 0.25rem;">
                        ${this.getDemandeActions(demande._id, demande.statut, 'restaurant')}
                        <button class="btn btn-xs btn-info" onclick="adminManager.showDemandeDetail('${demande._id}', 'restaurant')" title="Voir détails">
                            <i class="fas fa-eye"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

        // Mettre à jour le compteur de sélection
        this.updateSelectionCount('demandesRestaurants');
    }

    getDemandeActions(demandeId, statut, type) {
        if (statut === 'en_attente') {
            return `
                <button class="btn btn-xs btn-success" onclick="adminManager.approveDemande('${demandeId}', '${type}')" title="Approuver">
                    <i class="fas fa-check"></i>
                </button>
                <button class="btn btn-xs btn-danger" onclick="adminManager.rejectDemande('${demandeId}', '${type}')" title="Rejeter">
                    <i class="fas fa-times"></i>
                </button>
            `;
        } else if (statut === 'approuvee') {
            return `
                <button class="btn btn-xs btn-info" onclick="adminManager.sendNotification('${demandeId}', '${type}')" title="Renvoyer notification">
                    <i class="fas fa-paper-plane"></i>
                </button>
            `;
        }
        return '';
    }

    // ===== GESTION DES COLLECTIONS =====

    async loadCollection(collectionName) {
        try {
            this.currentCollection = collectionName;
            this.switchView('collection');
            
            // Mettre à jour les titres
            document.getElementById('collectionTitle').textContent = `Collection ${collectionName}`;
            document.getElementById('collectionSubtitle').textContent = `Gestion des données de ${collectionName}`;
            document.getElementById('collectionDataTitle').textContent = collectionName;

            this.showLoading(`Chargement de ${collectionName}...`);
            
            const response = await this.apiCall('getData', {
                collection: collectionName,
                limit: this.itemsPerPage,
                offset: (this.currentPage - 1) * this.itemsPerPage,
                search: document.getElementById('searchCollection')?.value || '',
                filters: this.currentFilters
            });

            if (response.success) {
                this.currentData = response.data || [];
                this.displayCollectionData(response.data || [], collectionName);
                this.displayPagination('paginationCollection', response.totalCount || 0, this.currentPage, 'loadCollectionPage');
                this.generateCollectionFilters(response.data || []);
            } else {
                this.showToast('Erreur', 'error', response.message);
            }
        } catch (error) {
            console.error('❌ Erreur loadCollection:', error);
            this.showToast('Erreur', 'error', 'Impossible de charger la collection');
        } finally {
            this.hideLoading();
        }
    }

    displayCollectionData(data, collectionName) {
        const thead = document.getElementById('tableCollectionHead');
        const tbody = document.getElementById('bodyCollection');

        if (!data || data.length === 0) {
            thead.innerHTML = '';
            tbody.innerHTML = `
                <tr>
                    <td colspan="100%" style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                        <i class="fas fa-database" style="font-size: 3rem; margin-bottom: 1rem; display: block;"></i>
                        Aucune donnée trouvée
                    </td>
                </tr>
            `;
            return;
        }

        // Générer les en-têtes
        const headers = this.getCollectionHeaders(data[0]);
        thead.innerHTML = `
            <tr>
                <th>
                    <input type="checkbox" class="checkbox" id="selectAllCollection" onchange="adminManager.toggleSelectAll('collection')">
                </th>
                ${headers.map(header => `<th>${this.formatHeaderName(header)}</th>`).join('')}
                <th>Actions</th>
            </tr>
        `;

        // Générer les lignes
        tbody.innerHTML = data.map(item => `
            <tr class="${this.selectedItems.has(item._id) ? 'row-selected' : ''}" onclick="this.handleRowClick('${item._id}', event)">
                <td class="checkbox-container">
                    <input type="checkbox" class="checkbox" 
                           ${this.selectedItems.has(item._id) ? 'checked' : ''} 
                           onchange="adminManager.toggleItemSelection('${item._id}', 'collection')"
                           onclick="event.stopPropagation()">
                </td>
                ${headers.map(header => `<td>${this.formatCellValue(item[header], header)}</td>`).join('')}
                <td onclick="event.stopPropagation();">
                    <div style="display: flex; gap: 0.25rem;">
                        <button class="btn btn-xs btn-info" onclick="adminManager.showItemDetail('${item._id}', '${collectionName}')" title="Voir détails">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-xs btn-warning" onclick="adminManager.editItem('${item._id}', '${collectionName}')" title="Modifier">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-xs btn-danger" onclick="adminManager.deleteItem('${item._id}', '${collectionName}')" title="Supprimer">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

        // Mettre à jour le compteur de sélection
        this.updateSelectionCount('collection');
    }

    getCollectionHeaders(item) {
        if (!item) return [];
        
        // Exclure certains champs techniques
        const excludeFields = ['_id', '__v', 'password', 'token'];
        return Object.keys(item).filter(key => !excludeFields.includes(key));
    }

    generateCollectionFilters(data) {
        const container = document.getElementById('collectionFilters');
        if (!data || data.length === 0) {
            container.innerHTML = '<p style="color: var(--text-secondary);">Aucun filtre disponible</p>';
            return;
        }

        // Générer des filtres basés sur les données
        const filters = [];
        const sample = data[0];

        if (sample.status || sample.statut) {
            const statusField = sample.status ? 'status' : 'statut';
            const uniqueStatuses = [...new Set(data.map(item => item[statusField]).filter(Boolean))];
            filters.push({
                name: 'Statut',
                field: statusField,
                type: 'select',
                options: uniqueStatuses
            });
        }

        if (sample.createdAt || sample.dateCreation) {
            filters.push({
                name: 'Période',
                field: 'period',
                type: 'select',
                options: ['Aujourd\'hui', 'Cette semaine', 'Ce mois', 'Cette année']
            });
        }

        container.innerHTML = filters.map(filter => `
            <div class="form-group">
                <label class="form-label">${filter.name}</label>
                <select class="form-select" data-field="${filter.field}">
                    <option value="">Tous</option>
                    ${filter.options.map(option => `<option value="${option}">${option}</option>`).join('')}
                </select>
            </div>
        `).join('');
    }

    // ===== ACTIONS SUR LES DEMANDES =====

    async approveDemande(demandeId, type) {
        try {
            this.currentApproval = { demandeId, type };
            document.getElementById('approveComment').value = '';
            document.getElementById('generatedCode').style.display = 'none';
            
            document.getElementById('confirmApprove').onclick = () => this.executeApproval();
            this.openModal('approveModal');
        } catch (error) {
            console.error('❌ Erreur approveDemande:', error);
            this.showToast('Erreur', 'error', 'Impossible d\'approuver la demande');
        }
    }

    async executeApproval() {
        try {
            this.showLoading('Approbation en cours...');
            
            const response = await this.apiCall('approuverDemande', {
                demandeId: this.currentApproval.demandeId,
                type: this.currentApproval.type,
                motif: document.getElementById('approveComment').value
            });

            if (response.success) {
                // Afficher le code généré
                document.getElementById('codeValue').textContent = response.identifiantGenere;
                document.getElementById('generatedCode').style.display = 'block';
                
                // Changer le bouton
                const btn = document.getElementById('confirmApprove');
                btn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer la notification';
                btn.onclick = () => this.sendApprovalNotification();
                
                this.showToast('Demande approuvée !', 'success', `Code généré: ${response.identifiantGenere}`);
            } else {
                this.showToast('Erreur', 'error', response.message);
            }
        } catch (error) {
            console.error('❌ Erreur executeApproval:', error);
            this.showToast('Erreur', 'error', 'Impossible d\'approuver la demande');
        } finally {
            this.hideLoading();
        }
    }

    async sendApprovalNotification() {
        try {
            const code = document.getElementById('codeValue').textContent;
            
            await this.apiCall('envoyerNotification', {
                demandeId: this.currentApproval.demandeId,
                type: this.currentApproval.type,
                message: `Félicitations ! Votre demande a été approuvée. Votre code d'autorisation: ${code}. Finalisez votre inscription sur notre site.`
            });
            
            this.closeModal('approveModal');
            this.refreshCurrentView();
            this.showToast('Notification envoyée !', 'success', 'Le candidat a été informé');
        } catch (error) {
            console.error('❌ Erreur sendApprovalNotification:', error);
            this.showToast('Erreur', 'error', 'Impossible d\'envoyer la notification');
        }
    }

    async rejectDemande(demandeId, type) {
        try {
            this.currentRejection = { demandeId, type };
            document.getElementById('rejectReason').value = '';
            
            document.getElementById('confirmReject').onclick = () => this.executeRejection();
            this.openModal('rejectModal');
        } catch (error) {
            console.error('❌ Erreur rejectDemande:', error);
            this.showToast('Erreur', 'error', 'Impossible de rejeter la demande');
        }
    }

    async executeRejection() {
        try {
            const reason = document.getElementById('rejectReason').value.trim();
            
            if (!reason) {
                this.showToast('Motif requis', 'warning', 'Veuillez indiquer le motif du rejet');
                return;
            }

            this.showLoading('Rejet en cours...');
            
            const response = await this.apiCall('rejeterDemande', {
                demandeId: this.currentRejection.demandeId,
                type: this.currentRejection.type,
                motif: reason
            });

            if (response.success) {
                // Envoyer la notification de rejet
                await this.apiCall('envoyerNotification', {
                    demandeId: this.currentRejection.demandeId,
                    type: this.currentRejection.type,
                    message: `Nous regrettons de vous informer que votre demande a été rejetée. Motif: ${reason}`
                });
                
                this.closeModal('rejectModal');
                this.refreshCurrentView();
                this.showToast('Demande rejetée', 'success', 'Le candidat sera informé');
            } else {
                this.showToast('Erreur', 'error', response.message);
            }
        } catch (error) {
            console.error('❌ Erreur executeRejection:', error);
            this.showToast('Erreur', 'error', 'Impossible de rejeter la demande');
        } finally {
            this.hideLoading();
        }
    }

    // ===== ACTIONS DE SUPPRESSION =====

    async deleteItem(itemId, collection) {
        this.currentDeletion = { itemId, collection };
        
        document.getElementById('deleteMessage').textContent = 
            `Êtes-vous sûr de vouloir supprimer cet élément ? Cette action est irréversible.`;
        
        document.getElementById('confirmDelete').onclick = () => this.executeDelete();
        this.openModal('deleteModal');
    }

    async executeDelete() {
        try {
            this.showLoading('Suppression en cours...');
            
            const response = await this.apiCall('deleteItem', {
                collection: this.currentDeletion.collection,
                itemId: this.currentDeletion.itemId
            });

            if (response.success) {
                this.closeModal('deleteModal');
                this.refreshCurrentView();
                this.showToast('Suppression réussie', 'success', 'L\'élément a été supprimé');
            } else {
                this.showToast('Erreur', 'error', response.message);
            }
        } catch (error) {
            console.error('❌ Erreur executeDelete:', error);
            this.showToast('Erreur', 'error', 'Impossible de supprimer l\'élément');
        } finally {
            this.hideLoading();
        }
    }

    // ===== ACTIONS EN MASSE =====

    async bulkAction(action, type, reason = null) {
        if (this.selectedItems.size === 0) {
            this.showToast('Aucune sélection', 'warning', 'Veuillez sélectionner au moins un élément');
            return;
        }

        const selectedIds = Array.from(this.selectedItems);
        
        try {
            this.showLoading(`${action} en cours...`);
            
            const promises = selectedIds.map(id => {
                switch(action) {
                    case 'approve':
                        return this.apiCall('approuverDemande', { demandeId: id, type, motif: reason });
                    case 'reject':
                        return this.apiCall('rejeterDemande', { demandeId: id, type, motif: reason });
                    case 'delete':
                        return this.apiCall('deleteItem', { collection: this.currentCollection, itemId: id });
                    default:
                        return Promise.resolve({ success: false, message: 'Action inconnue' });
                }
            });

            const results = await Promise.all(promises);
            const successCount = results.filter(r => r.success).length;
            const failCount = results.length - successCount;

            this.closeModal('bulkActionModal');
            this.refreshCurrentView();
            this.selectedItems.clear();
            this.updateSelectionCount();

            if (successCount > 0) {
                this.showToast(`${action} terminé`, 'success', 
                    `${successCount} élément(s) traité(s)${failCount > 0 ? `, ${failCount} échec(s)` : ''}`);
            } else {
                this.showToast('Échec', 'error', 'Aucun élément n\'a pu être traité');
            }
        } catch (error) {
            console.error(`❌ Erreur ${action}:`, error);
            this.showToast('Erreur', 'error', `Impossible d'effectuer l'action ${action}`);
        } finally {
            this.hideLoading();
        }
    }

    // ===== SÉLECTION D'ÉLÉMENTS =====

    toggleItemSelection(itemId, viewType) {
        if (this.selectedItems.has(itemId)) {
            this.selectedItems.delete(itemId);
        } else {
            this.selectedItems.add(itemId);
        }
        
        this.updateSelectionCount(viewType);
        this.updateRowSelection(itemId);
    }

    toggleSelectAll(viewType) {
        const selectAllCheckbox = document.getElementById(`selectAll${viewType === 'collection' ? 'Collection' : viewType === 'demandesLivreurs' ? 'Livreurs' : 'Restaurants'}`);
        
        if (selectAllCheckbox.checked) {
            // Sélectionner tous les éléments visibles
            this.currentData.forEach(item => {
                this.selectedItems.add(item._id);
            });
        } else {
            // Désélectionner tous
            this.selectedItems.clear();
        }
        
        this.updateSelectionCount(viewType);
        this.updateAllRowSelections();
    }

    updateSelectionCount(viewType = null) {
        const count = this.selectedItems.size;
        
        // Mettre à jour les compteurs
        ['selectedCountLivreurs', 'selectedCountRestaurants', 'selectedCountCollection'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = `${count} sélectionné(s)`;
            }
        });

        // Afficher/masquer les barres d'actions
        ['actionsBarLivreurs', 'actionsBarRestaurants', 'actionsBarCollection'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.style.display = count > 0 ? 'flex' : 'none';
            }
        });

        // Mettre à jour les checkboxes "tout sélectionner"
        this.updateSelectAllCheckboxes();
    }

    updateSelectAllCheckboxes() {
        const totalVisible = this.currentData.length;
        const selectedVisible = this.currentData.filter(item => this.selectedItems.has(item._id)).length;
        
        ['selectAllLivreurs', 'selectAllRestaurants', 'selectAllCollection'].forEach(id => {
            const checkbox = document.getElementById(id);
            if (checkbox) {
                checkbox.checked = selectedVisible > 0 && selectedVisible === totalVisible;
                checkbox.indeterminate = selectedVisible > 0 && selectedVisible < totalVisible;
            }
        });
    }

    updateRowSelection(itemId) {
        const row = document.querySelector(`tr[onclick*="${itemId}"]`);
        if (row) {
            if (this.selectedItems.has(itemId)) {
                row.classList.add('row-selected');
            } else {
                row.classList.remove('row-selected');
            }
        }
    }

    updateAllRowSelections() {
        document.querySelectorAll('tbody tr').forEach(row => {
            const checkbox = row.querySelector('input[type="checkbox"]');
            if (checkbox) {
                checkbox.checked = this.selectedItems.has(checkbox.getAttribute('onchange')?.match(/'([^']+)'/)?.[1]);
                if (checkbox.checked) {
                    row.classList.add('row-selected');
                } else {
                    row.classList.remove('row-selected');
                }
            }
        });
    }

    // ===== RECHERCHE ET FILTRES =====

    handleGlobalSearch(query) {
        if (!query || query.length < 2) return;
        
        console.log('🔍 Recherche globale:', query);
        // Implémenter la recherche globale
    }

    handleViewSearch(query) {
        this.currentPage = 1;
        this.refreshCurrentView();
    }

    applyFilters(viewType) {
        this.currentPage = 1;
        
        switch(viewType) {
            case 'livreurs':
                this.loadDemandesLivreurs();
                break;
            case 'restaurants':
                this.loadDemandesRestaurants();
                break;
            case 'collection':
                this.loadCollection(this.currentCollection);
                break;
        }
    }

    resetFilters(viewType) {
        // Réinitialiser les filtres
        const filterContainer = document.getElementById(`filters${viewType.charAt(0).toUpperCase() + viewType.slice(1)}`);
        if (filterContainer) {
            filterContainer.querySelectorAll('select, input').forEach(element => {
                element.value = '';
            });
        }
        
        this.currentFilters = {};
        this.applyFilters(viewType);
    }

    // ===== PAGINATION =====

    displayPagination(containerId, totalCount, currentPage, loadFunction) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const totalPages = Math.ceil(totalCount / this.itemsPerPage);
        
        if (totalPages <= 1) {
            container.innerHTML = `
                <div style="text-align: center; color: var(--text-secondary); padding: 1rem;">
                    ${totalCount} élément(s) trouvé(s)
                </div>
            `;
            return;
        }

        let buttons = '';
        
        // Bouton précédent
        buttons += `
            <button class="pagination-btn" ${currentPage <= 1 ? 'disabled' : ''} 
                    onclick="adminManager.changePage(${currentPage - 1}, '${loadFunction}')">
                <i class="fas fa-chevron-left"></i>
            </button>
        `;
        
        // Numéros de page
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, startPage + 4);
        
        for (let i = startPage; i <= endPage; i++) {
            buttons += `
                <button class="pagination-btn ${i === currentPage ? 'active' : ''}" 
                        onclick="adminManager.changePage(${i}, '${loadFunction}')">
                    ${i}
                </button>
            `;
        }
        
        // Bouton suivant
        buttons += `
            <button class="pagination-btn" ${currentPage >= totalPages ? 'disabled' : ''} 
                    onclick="adminManager.changePage(${currentPage + 1}, '${loadFunction}')">
                <i class="fas fa-chevron-right"></i>
            </button>
        `;

        container.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); margin-bottom: 1rem;">
                Affichage de ${((currentPage - 1) * this.itemsPerPage) + 1} à ${Math.min(currentPage * this.itemsPerPage, totalCount)} sur ${totalCount} éléments
            </div>
            <div style="display: flex; justify-content: center; gap: 0.5rem; flex-wrap: wrap;">
                ${buttons}
            </div>
        `;
    }

    changePage(page, loadFunction) {
        this.currentPage = page;
        
        switch(loadFunction) {
            case 'loadDemandesLivreurs':
                this.loadDemandesLivreurs(page);
                break;
            case 'loadDemandesRestaurants':
                this.loadDemandesRestaurants(page);
                break;
            case 'loadCollectionPage':
                this.loadCollection(this.currentCollection);
                break;
        }
    }

    // ===== AFFICHAGE DES DÉTAILS =====

    async showDemandeDetail(demandeId, type) {
        try {
            const demande = this.currentData.find(d => d._id === demandeId);
            if (!demande) {
                this.showToast('Erreur', 'error', 'Demande non trouvée');
                return;
            }

            document.getElementById('detailModalTitle').innerHTML = `
                <i class="fas fa-${type === 'livreur' ? 'user' : 'store'}"></i>
                Détails de la demande
            `;

            const modalBody = document.getElementById('detailModalBody');
            modalBody.innerHTML = this.generateDetailView(demande, type);
            
            this.openModal('detailModal');
        } catch (error) {
            console.error('❌ Erreur showDemandeDetail:', error);
            this.showToast('Erreur', 'error', 'Impossible d\'afficher les détails');
        }
    }

    async showItemDetail(itemId, collection) {
        try {
            const item = this.currentData.find(i => i._id === itemId);
            if (!item) {
                this.showToast('Erreur', 'error', 'Élément non trouvé');
                return;
            }

            document.getElementById('detailModalTitle').innerHTML = `
                <i class="fas fa-info-circle"></i>
                Détails - ${collection}
            `;

            const modalBody = document.getElementById('detailModalBody');
            modalBody.innerHTML = this.generateItemDetailView(item, collection);
            
            this.openModal('detailModal');
        } catch (error) {
            console.error('❌ Erreur showItemDetail:', error);
            this.showToast('Erreur', 'error', 'Impossible d\'afficher les détails');
        }
    }

    generateDetailView(demande, type) {
        const fields = type === 'livreur' ? 
            this.getLivreurDetailFields(demande) : 
            this.getRestaurantDetailFields(demande);

        return `
            <div class="detail-grid">
                ${fields.map(field => `
                    <div class="detail-item">
                        <div class="detail-label">${field.label}</div>
                        <div class="detail-value">${field.value}</div>
                    </div>
                `).join('')}
            </div>
            ${this.generateDocumentsSection(demande)}
            ${this.generateSignatureSection(demande)}
        `;
    }

    generateItemDetailView(item, collection) {
        const fields = Object.keys(item).filter(key => !['_id', '__v'].includes(key));
        
        return `
            <div class="detail-grid">
                ${fields.map(field => `
                    <div class="detail-item">
                        <div class="detail-label">${this.formatHeaderName(field)}</div>
                        <div class="detail-value">${this.formatCellValue(item[field], field)}</div>
                    </div>
                `).join('')}
            </div>
            <div style="margin-top: 2rem;">
                <h4 style="margin-bottom: 1rem;">Données brutes (JSON)</h4>
                <div class="json-viewer">${JSON.stringify(item, null, 2)}</div>
            </div>
        `;
    }

    getLivreurDetailFields(demande) {
        return [
            { label: 'Nom complet', value: `${demande.nom || ''} ${demande.prenom || ''}` },
            { label: 'WhatsApp', value: demande.whatsapp || '-' },
            { label: 'Téléphone', value: demande.telephone || '-' },
            { label: 'Quartier', value: demande.quartier || '-' },
            { label: 'Date de naissance', value: demande.dateNaissance ? this.formatDate(demande.dateNaissance) : '-' },
            { label: 'Véhicule', value: demande.vehicule || '-' },
            { label: 'Immatriculation', value: demande.immatriculation || '-' },
            { label: 'Expérience', value: demande.experience || '-' },
            { label: 'Contact d\'urgence', value: demande.contactUrgence?.nom ? 
                `${demande.contactUrgence.nom} (${demande.contactUrgence.telephone})` : '-' },
            { label: 'Date de demande', value: this.formatDate(demande.dateCreation) },
            { label: 'Statut', value: this.getStatusBadge(demande.statut) },
            { label: 'Code généré', value: demande.identifiantGenere || '-' }
        ];
    }

    getRestaurantDetailFields(demande) {
        return [
            { label: 'Nom du restaurant', value: demande.nom || '-' },
            { label: 'Nom commercial', value: demande.nomCommercial || '-' },
            { label: 'Téléphone', value: demande.telephone || '-' },
            { label: 'Email', value: demande.email || '-' },
            { label: 'Adresse', value: demande.adresse || '-' },
            { label: 'Quartier', value: demande.quartier || '-' },
            { label: 'Type de cuisine', value: demande.cuisine || '-' },
            { label: 'Spécialités', value: demande.specialites || '-' },
            { label: 'Horaires', value: demande.horairesDetails || '-' },
            { label: 'Responsable', value: demande.responsableNom || '-' },
            { label: 'Tél. responsable', value: demande.responsableTel || '-' },
            { label: 'Description', value: demande.description || '-' },
            { label: 'GPS', value: demande.location ? 
                `${demande.location.latitude}, ${demande.location.longitude} (±${Math.round(demande.location.accuracy)}m)` : '-' },
            { label: 'Date de demande', value: this.formatDate(demande.dateCreation) },
            { label: 'Statut', value: this.getStatusBadge(demande.statut) },
            { label: 'Code généré', value: demande.identifiantGenere || '-' }
        ];
    }

    generateDocumentsSection(demande) {
        if (!demande.documents) return '';

        let documentsHtml = '<h4 style="margin: 2rem 0 1rem;">Documents</h4><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">';

        if (demande.documents.photoIdentite) {
            documentsHtml += `
                <div>
                    <div style="font-weight: 600; margin-bottom: 0.5rem;">Photo d'identité</div>
                    <img src="data:image/jpeg;base64,${demande.documents.photoIdentite.data}" 
                         class="image-preview" alt="Photo d'identité">
                </div>
            `;
        }

        if (demande.documents.documentVehicule) {
            documentsHtml += `
                <div>
                    <div style="font-weight: 600; margin-bottom: 0.5rem;">Document véhicule</div>
                    <img src="data:image/jpeg;base64,${demande.documents.documentVehicule.data}" 
                         class="image-preview" alt="Document véhicule">
                </div>
            `;
        }

        // Pour les restaurants
        if (demande.logo) {
            documentsHtml += `
                <div>
                    <div style="font-weight: 600; margin-bottom: 0.5rem;">Logo</div>
                    <img src="data:image/jpeg;base64,${demande.logo.base64}" 
                         class="image-preview" alt="Logo">
                </div>
            `;
        }

        if (demande.photos && demande.photos.length > 0) {
            demande.photos.forEach((photo, index) => {
                documentsHtml += `
                    <div>
                        <div style="font-weight: 600; margin-bottom: 0.5rem;">Photo ${index + 1}</div>
                        <img src="data:image/jpeg;base64,${photo.base64}" 
                             class="image-preview" alt="Photo restaurant">
                    </div>
                `;
            });
        }

        documentsHtml += '</div>';
        return documentsHtml;
    }

    generateSignatureSection(demande) {
        if (!demande.signature) return '';

        return `
            <h4 style="margin: 2rem 0 1rem;">Signature électronique</h4>
            <div style="text-align: center;">
                <img src="data:image/png;base64,${demande.signature}" 
                     style="max-width: 300px; border: 1px solid var(--border); border-radius: var(--radius);" 
                     alt="Signature">
            </div>
        `;
    }

    // ===== UTILITAIRES D'AFFICHAGE =====

    formatDate(date) {
        if (!date) return '-';
        return new Date(date).toLocaleDateString('fr-FR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatTime(date) {
        if (!date) return '-';
        return new Date(date).toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatNumber(num) {
        if (typeof num !== 'number') return num;
        return num.toLocaleString('fr-FR');
    }

    formatHeaderName(header) {
        return header
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .replace(/_/g, ' ');
    }

    formatCellValue(value, field) {
        if (value === null || value === undefined || value === '') return '-';
        
        if (typeof value === 'object') {
            if (value instanceof Date) {
                return this.formatDate(value);
            }
            return JSON.stringify(value);
        }
        
        if (typeof value === 'boolean') {
            return value ? 'Oui' : 'Non';
        }
        
        if (field && (field.includes('date') || field.includes('Date'))) {
            return this.formatDate(value);
        }
        
        if (field && (field.includes('price') || field.includes('Price') || field.includes('prix'))) {
            return `${this.formatNumber(value)} FCFA`;
        }
        
        return String(value);
    }

    getStatusBadge(status) {
        const badges = {
            'en_attente': '<span class="badge badge-warning">En Attente</span>',
            'approuvee': '<span class="badge badge-success">Approuvée</span>',
            'rejetee': '<span class="badge badge-danger">Rejetée</span>',
            'finalisee': '<span class="badge badge-info">Finalisée</span>',
            'actif': '<span class="badge badge-success">Actif</span>',
            'inactif': '<span class="badge badge-secondary">Inactif</span>',
            'suspendu': '<span class="badge badge-warning">Suspendu</span>',
            'pending': '<span class="badge badge-warning">En cours</span>',
            'completed': '<span class="badge badge-success">Terminé</span>',
            'cancelled': '<span class="badge badge-danger">Annulé</span>'
        };
        return badges[status] || `<span class="badge badge-secondary">${status}</span>`;
    }

    getActivityBadgeType(type) {
        const types = {
            'Livraison': 'info',
            'Demande': 'warning',
            'Restaurant': 'success',
            'Colis': 'primary'
        };
        return types[type] || 'secondary';
    }

    getStatusBadgeType(status) {
        const types = {
            'success': 'success',
            'pending': 'warning',
            'error': 'danger',
            'info': 'info'
        };
        return types[status] || 'secondary';
    }

    getStatusText(status) {
        const texts = {
            'success': 'Succès',
            'pending': 'En attente',
            'error': 'Erreur',
            'info': 'Info'
        };
        return texts[status] || status;
    }

    // ===== GESTION DES MODALES =====

    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('open');
            document.body.style.overflow = 'hidden';
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('open');
            document.body.style.overflow = '';
        }
    }

    closeAllModals() {
        document.querySelectorAll('.modal.open').forEach(modal => {
            modal.classList.remove('open');
        });
        document.body.style.overflow = '';
    }

    // ===== INTERFACE UTILISATEUR =====

    showLoading(message = 'Chargement...') {
        const overlay = document.getElementById('loadingOverlay');
        const messageEl = document.getElementById('loadingMessage');
        
        if (overlay && messageEl) {
            messageEl.textContent = message;
            overlay.classList.add('show');
        }
    }

    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.remove('show');
        }
    }

    showToast(title, type = 'info', message = '') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toastId = 'toast-' + Date.now();
        const iconMap = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };

        const toast = document.createElement('div');
        toast.id = toastId;
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="toast-content">
                <div class="toast-icon ${type}">
                    <i class="fas ${iconMap[type] || iconMap.info}"></i>
                </div>
                <div class="toast-body">
                    <div class="toast-title">${title}</div>
                    ${message ? `<div class="toast-message">${message}</div>` : ''}
                </div>
            </div>
            <button class="toast-close" onclick="adminManager.closeToast('${toastId}')">
                <i class="fas fa-times"></i>
            </button>
        `;

        container.appendChild(toast);

        // Auto fermeture après 5 secondes
        setTimeout(() => {
            this.closeToast(toastId);
        }, 5000);
    }

    closeToast(toastId) {
        const toast = document.getElementById(toastId);
        if (toast) {
            toast.style.animation = 'slideOut 0.3s ease-out forwards';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
                }
            }, 300);
        }
    }

    updateBadge(badgeId, count) {
        const badge = document.getElementById(badgeId);
        if (badge) {
            badge.textContent = count || 0;
            badge.style.display = count > 0 ? 'inline' : 'none';
        }
    }

    // ===== GESTION DU THÈME =====

    setupTheme() {
        const savedTheme = localStorage.getItem('adminTheme') || 'light';
        document.body.setAttribute('data-theme', savedTheme);
        this.updateThemeIcon(savedTheme);
    }

    toggleTheme() {
        const currentTheme = document.body.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        document.body.setAttribute('data-theme', newTheme);
        localStorage.setItem('adminTheme', newTheme);
        this.updateThemeIcon(newTheme);
    }

    updateThemeIcon(theme) {
        const icon = document.getElementById('themeIcon');
        if (icon) {
            icon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
        }
    }

    // ===== SIDEBAR =====

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        const main = document.getElementById('main');
        
        if (window.innerWidth >= 768) {
            // Desktop - toggle classe
            main.classList.toggle('sidebar-open');
            sidebar.classList.toggle('open');
        } else {
            // Mobile - overlay
            sidebar.classList.toggle('open');
            overlay.classList.toggle('show');
        }
    }

    closeSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
    }

    handleResize() {
        if (window.innerWidth >= 768) {
            this.closeSidebar();
            document.getElementById('main').classList.add('sidebar-open');
        } else {
            document.getElementById('main').classList.remove('sidebar-open');
        }
    }

    // ===== COMMUNICATION AVEC L'API =====

    async apiCall(action, data = {}) {
        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action,
                    ...data
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('❌ Erreur API:', error);
            throw error;
        }
    }

    // ===== UTILITAIRES =====

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    startAutoRefresh() {
        // Actualiser le dashboard toutes les 5 minutes
        this.autoRefreshInterval = setInterval(() => {
            if (this.currentView === 'dashboard') {
                this.loadDashboard();
            }
        }, 5 * 60 * 1000);
    }

    refreshCurrentView() {
        switch(this.currentView) {
            case 'dashboard':
                this.loadDashboard();
                break;
            case 'demandes-livreurs':
                this.loadDemandesLivreurs(this.currentPage);
                break;
            case 'demandes-restaurants':
                this.loadDemandesRestaurants(this.currentPage);
                break;
            case 'collection':
                if (this.currentCollection) {
                    this.loadCollection(this.currentCollection);
                }
                break;
        }
    }

    hasUnsavedChanges() {
        // Vérifier s'il y a des changements non sauvegardés
        return false; // À implémenter selon les besoins
    }

    // ===== MÉTHODES PUBLIQUES POUR LES ÉVÉNEMENTS =====

    handleRowClick(itemId, event) {
        if (event.ctrlKey || event.metaKey) {
            // Sélection multiple avec Ctrl/Cmd
            this.toggleItemSelection(itemId, this.currentView);
        }
    }

    // Méthodes pour les boutons du template
    refreshDashboard() { this.loadDashboard(); }
    refreshDemandesLivreurs() { this.loadDemandesLivreurs(this.currentPage); }
    refreshDemandesRestaurants() { this.loadDemandesRestaurants(this.currentPage); }
    refreshCollection() { if (this.currentCollection) this.loadCollection(this.currentCollection); }

    applyFiltersLivreurs() { this.applyFilters('livreurs'); }
    applyFiltersRestaurants() { this.applyFilters('restaurants'); }
    applyCollectionFilters() { this.applyFilters('collection'); }

    resetFiltersLivreurs() { this.resetFilters('livreurs'); }
    resetFiltersRestaurants() { this.resetFilters('restaurants'); }
    resetCollectionFilters() { this.resetFilters('collection'); }

    toggleFilters(filterId) {
        const filters = document.getElementById(filterId);
        if (filters) {
            filters.classList.toggle('open');
        }
    }

    selectAllVisible(viewType) {
        const checkbox = document.getElementById(`selectAll${viewType === 'collection' ? 'Collection' : viewType === 'demandesLivreurs' ? 'Livreurs' : 'Restaurants'}`);
        if (checkbox) {
            checkbox.checked = true;
            this.toggleSelectAll(viewType);
        }
    }

    // Actions en masse pour les différentes vues
    bulkApproveLivreurs() {
        this.showBulkActionModal('approve', 'livreur', 'Approuver les demandes sélectionnées');
    }

    bulkRejectLivreurs() {
        this.showBulkActionModal('reject', 'livreur', 'Rejeter les demandes sélectionnées', true);
    }

    bulkApproveRestaurants() {
        this.showBulkActionModal('approve', 'restaurant', 'Approuver les demandes sélectionnées');
    }

    bulkRejectRestaurants() {
        this.showBulkActionModal('reject', 'restaurant', 'Rejeter les demandes sélectionnées', true);
    }

    bulkDeleteCollection() {
        this.showBulkActionModal('delete', 'collection', 'Supprimer les éléments sélectionnés');
    }

    showBulkActionModal(action, type, message, requireReason = false) {
        if (this.selectedItems.size === 0) {
            this.showToast('Aucune sélection', 'warning', 'Veuillez sélectionner au moins un élément');
            return;
        }

        document.getElementById('bulkActionTitle').textContent = this.getBulkActionTitle(action);
        document.getElementById('bulkActionConfirmTitle').textContent = this.getBulkActionTitle(action);
        document.getElementById('bulkActionMessage').textContent = `${message} (${this.selectedItems.size} élément(s)) ?`;
        
        const reasonGroup = document.getElementById('bulkActionReasonGroup');
        const reasonInput = document.getElementById('bulkActionReason');
        
        if (requireReason) {
            reasonGroup.style.display = 'block';
            reasonInput.value = '';
            reasonInput.required = true;
        } else {
            reasonGroup.style.display = 'none';
            reasonInput.required = false;
        }

        document.getElementById('confirmBulkAction').onclick = () => {
            const reason = requireReason ? reasonInput.value.trim() : null;
            if (requireReason && !reason) {
                this.showToast('Motif requis', 'warning', 'Veuillez indiquer un motif');
                return;
            }
            this.bulkAction(action, type, reason);
        };

        this.openModal('bulkActionModal');
    }

    getBulkActionTitle(action) {
        const titles = {
            'approve': 'Approuver en masse',
            'reject': 'Rejeter en masse',
            'delete': 'Supprimer en masse'
        };
        return titles[action] || 'Action en masse';
    }

    // Export functions
    exportDemandesLivreurs() {
        this.exportData('demandes_livreurs', this.currentData);
    }

    exportDemandesRestaurants() {
        this.exportData('demandes_restaurants', this.currentData);
    }

    exportCollection() {
        this.exportData(this.currentCollection || 'collection', this.currentData);
    }

    exportReport() {
        this.showToast('Export', 'info', 'Génération du rapport en cours...');
    }

    exportData(name, data) {
        if (!data || data.length === 0) {
            this.showToast('Aucune donnée', 'warning', 'Aucune donnée à exporter');
            return;
        }

        try {
            // Nettoyer les données pour l'export
            const cleanData = data.map(item => {
                const clean = { ...item };
                delete clean._id;
                delete clean.__v;
                // Simplifier les objets complexes
                Object.keys(clean).forEach(key => {
                    if (typeof clean[key] === 'object' && clean[key] !== null) {
                        clean[key] = JSON.stringify(clean[key]);
                    }
                });
                return clean;
            });

            // Créer le CSV
            const headers = Object.keys(cleanData[0]);
            const csvContent = [
                headers.join(','),
                ...cleanData.map(row => headers.map(header => `"${(row[header] || '').toString().replace(/"/g, '""')}"`).join(','))
            ].join('\n');

            // Télécharger
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${name}_${new Date().toISOString().split('T')[0]}.csv`;
            link.click();

            this.showToast('Export réussi', 'success', `${data.length} éléments exportés`);
        } catch (error) {
            console.error('❌ Erreur export:', error);
            this.showToast('Erreur export', 'error', 'Impossible d\'exporter les données');
        }
    }

    // Autres fonctions UI
    toggleNotifications() {
        this.showToast('Notifications', 'info', 'Aucune nouvelle notification');
    }

    showProfile() {
        this.showToast('Profil', 'info', 'Profil administrateur');
    }

    loadAnalytics() {
        this.showToast('Analyses', 'info', 'Module d\'analyses en développement');
    }

    loadSettings() {
        this.showToast('Paramètres', 'info', 'Module de paramètres en développement');
    }

    // Fonctions de création et modification
    showCreateModal() {
        if (!this.currentCollection) {
            this.showToast('Erreur', 'error', 'Aucune collection sélectionnée');
            return;
        }
        
        this.showToast('Création', 'info', 'Module de création en développement');
    }

    editItem(itemId, collection) {
        this.showToast('Modification', 'info', 'Module de modification en développement');
    }

    async sendNotification(demandeId, type) {
        try {
            this.showLoading('Envoi de la notification...');
            
            const response = await this.apiCall('envoyerNotification', {
                demandeId,
                type
            });

            if (response.success) {
                this.showToast('Notification envoyée !', 'success', `Message envoyé à ${response.destinataire || 'le destinataire'}`);
            } else {
                this.showToast('Erreur', 'error', response.message);
            }
        } catch (error) {
            console.error('❌ Erreur sendNotification:', error);
            this.showToast('Erreur', 'error', 'Impossible d\'envoyer la notification');
        } finally {
            this.hideLoading();
        }
    }
}

// Initialisation
let adminManager;

document.addEventListener('DOMContentLoaded', () => {
    adminManager = new AdminManager();
    
    // Exposer les méthodes nécessaires globalement
    window.adminManager = adminManager;
    
    // Méthodes pour les événements onclick
    window.toggleSidebar = () => adminManager.toggleSidebar();
    window.closeSidebar = () => adminManager.closeSidebar();
    window.toggleTheme = () => adminManager.toggleTheme();
    window.toggleNotifications = () => adminManager.toggleNotifications();
    window.showProfile = () => adminManager.showProfile();
    window.refreshDashboard = () => adminManager.refreshDashboard();
    window.exportReport = () => adminManager.exportReport();
    window.closeModal = (modalId) => adminManager.closeModal(modalId);
});

// Gestion des erreurs globales
window.addEventListener('error', (e) => {
    console.error('💥 Erreur globale:', e.error);
    if (adminManager) {
        adminManager.showToast('Erreur système', 'error', 'Une erreur inattendue s\'est produite');
    }
});

// Gestion des promesses rejetées
window.addEventListener('unhandledrejection', (e) => {
    console.error('💥 Promise rejetée:', e.reason);
    if (adminManager) {
        adminManager.showToast('Erreur réseau', 'error', 'Problème de connexion détecté');
    }
});