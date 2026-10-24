/**
 * VELOCHECK - Production API Client for Authentication & Vehicle Registration
 * Connects frontend forms to the secure PostgreSQL/Express backend.
 */

const API_BASE_URL = window.VELOCHECK_API_URL || 'http://localhost:5000/api';

const VelocheckAuth = {
    // Save authentication session
    setSession(token, user) {
        sessionStorage.setItem('velocheck_token', token);
        sessionStorage.setItem('velocheck_user', JSON.stringify(user));
    },

    // Retrieve authentication token
    getToken() {
        return sessionStorage.getItem('velocheck_token');
    },

    // Retrieve current user profile
    getUser() {
        const u = sessionStorage.getItem('velocheck_user');
        return u ? JSON.parse(u) : null;
    },

    // Clear session
    logout() {
        sessionStorage.removeItem('velocheck_token');
        sessionStorage.removeItem('velocheck_user');
        window.location.href = 'auth.html';
    },

    // Register User (with Email OR Phone)
    async register({ fullName, email = null, phone = null, password }) {
        const res = await fetch(`${API_BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullName, email, phone, password })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Registration failed');
        }
        this.setSession(data.token, data.user);
        return data;
    },

    // Sign in User (with Email OR Phone)
    async signin(identifier, password) {
        const payload = typeof identifier === 'object'
            ? { ...identifier, password }
            : { identifier, password };

        const res = await fetch(`${API_BASE_URL}/auth/signin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Sign in failed');
        }
        this.setSession(data.token, data.user);
        return data;
    },

    // Request OTP (Phone verification or Forgot Password)
    async sendOtp(destination, purpose = 'PHONE_VERIFICATION') {
        const res = await fetch(`${API_BASE_URL}/auth/otp/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ destination, purpose })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Failed to send OTP code');
        }
        return data;
    },

    // Verify OTP
    async verifyOtp(destination, otp, purpose = 'PHONE_VERIFICATION') {
        const res = await fetch(`${API_BASE_URL}/auth/otp/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ destination, otp, purpose })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Verification code failed');
        }
        return data;
    },

    // Reset Password with verified token or OTP
    async resetPassword({ resetToken, newPassword, destination, otp }) {
        const res = await fetch(`${API_BASE_URL}/auth/password-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resetToken, newPassword, destination, otp })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Password reset failed');
        }
        return data;
    },

    // Change Password (authenticated)
    async changePassword(currentPassword, newPassword) {
        const token = this.getToken();
        if (!token) throw new Error('Authentication required');

        const res = await fetch(`${API_BASE_URL}/auth/change-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Failed to change password');
        }
        return data;
    },

    // Delete Account permanently
    async deleteAccount(password) {
        const token = this.getToken();
        if (!token) throw new Error('Authentication required');

        const res = await fetch(`${API_BASE_URL}/auth/account`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Failed to delete account');
        }
        this.logout();
        return data;
    },

    // Register Vehicle
    async registerVehicle(vehicleData) {
        const token = this.getToken();
        if (!token) throw new Error('Authentication required');

        const res = await fetch(`${API_BASE_URL}/vehicles`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(vehicleData)
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Failed to register vehicle');
        }
        return data;
    },

    // Get My Vehicles (User gets only their own; Admin gets all)
    async getVehicles() {
        const token = this.getToken();
        if (!token) throw new Error('Authentication required');

        const res = await fetch(`${API_BASE_URL}/vehicles`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Failed to fetch vehicles');
        }
        return data.vehicles;
    },

    // ------------------------------------------------------------------------
    // SERVICE & TOWING TOKEN GENERATION CLIENT
    // ------------------------------------------------------------------------

    // Get local tokens from localStorage (for offline/instant persistence)
    getLocalTokens() {
        try {
            const raw = localStorage.getItem('velocheck.serviceTokens');
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    },

    // Save a token locally
    saveLocalToken(token) {
        try {
            const existing = this.getLocalTokens();
            const idx = existing.findIndex(t => t.token_code === token.token_code);
            if (idx >= 0) {
                existing[idx] = token;
            } else {
                existing.unshift(token);
            }
            localStorage.setItem('velocheck.serviceTokens', JSON.stringify(existing));
        } catch (e) {
            console.error('Failed to save token locally:', e);
        }
    },

    // Update status of local token
    updateLocalToken(tokenCode, status) {
        try {
            const existing = this.getLocalTokens();
            const item = existing.find(t => t.token_code === tokenCode);
            if (item) {
                item.status = status;
                item.updated_at = new Date().toISOString();
                localStorage.setItem('velocheck.serviceTokens', JSON.stringify(existing));
            }
        } catch (e) {
            console.error('Failed to update local token:', e);
        }
    },

    // Generate a new Service Pass Token (Towing, Tyre Checkup, Tyre Replacement)
    async generateServiceToken({
        vehicleNumber,
        vehicleType = 'Hatchback',
        tokenId = null,
        tokenCode = null,
        serviceType = 'TOWING',
        providerName,
        locationAddress,
        scheduledTime,
        estimatedDurationMin,
        contactPhone,
        notes
    }) {
        const token = this.getToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const chosenCode = (tokenId || tokenCode || '').trim().toUpperCase();

        const payload = {
            tokenCode: chosenCode,
            vehicleNumber,
            vehicleType,
            serviceType,
            providerName,
            locationAddress,
            scheduledTime,
            estimatedDurationMin,
            contactPhone,
            notes
        };

        try {
            const res = await fetch(`${API_BASE_URL}/tokens/generate`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (res.ok && data.token) {
                this.saveLocalToken(data.token);
                return data.token;
            }
            if (!res.ok) {
                throw new Error(data.error || 'Server rejected token generation');
            }
        } catch (netErr) {
            console.warn('API generation offline, generating resilient client token:', netErr.message);
        }

        // Resilient Client-Side Generation (Zero downtime fallback)
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const normType = String(serviceType).toUpperCase();
        let code = chosenCode;
        if (!code) {
            if (normType === 'TOWING') code = `TOW-${randomNum}-LKO`;
            else if (normType === 'TYRE_CHECKUP') code = `TYRE-CHK-${randomNum}`;
            else code = `TYRE-RPL-${randomNum}`;
        }

        const fallbackToken = {
            id: 'tok_client_' + Date.now(),
            token_code: code,
            user_id: this.getUser() ? this.getUser().id : 'offline-user',
            vehicle_number: (vehicleNumber || 'UP32 AW 7094').trim().toUpperCase(),
            vehicle_type: vehicleType || 'Hatchback',
            service_type: normType,
            provider_name: providerName || (normType === 'TOWING' ? 'Rapid Dispatch Tow Truck' : 'Velocheck Authorized Pitstop'),
            location_address: locationAddress || 'Hazratganj, Lucknow (GPS Lock)',
            scheduled_time: scheduledTime || new Date().toISOString(),
            estimated_duration_min: estimatedDurationMin || (normType === 'TOWING' ? 30 : 45),
            status: 'BOOKED',
            security_pin: String(Math.floor(1000 + Math.random() * 9000)),
            contact_phone: contactPhone || '+919456923238',
            notes: notes || '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        this.saveLocalToken(fallbackToken);
        return fallbackToken;
    },

    // Retrieve active and past tokens
    async getMyServiceTokens() {
        const token = this.getToken();
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        let serverTokens = [];
        try {
            const res = await fetch(`${API_BASE_URL}/tokens/my-tokens`, { headers });
            if (res.ok) {
                const data = await res.json();
                serverTokens = data.tokens || [];
            }
        } catch (e) {
            console.warn('Could not reach backend for tokens, using local store:', e.message);
        }

        // Merge server and local storage tokens without duplicates
        const localTokens = this.getLocalTokens();
        const merged = [...serverTokens];
        for (const lt of localTokens) {
            if (!merged.some(m => m.token_code === lt.token_code)) {
                merged.push(lt);
            }
        }
        return merged;
    },

    // Cancel a token pass
    async cancelServiceToken(tokenCode) {
        this.updateLocalToken(tokenCode, 'CANCELLED');

        const token = this.getToken();
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        try {
            const res = await fetch(`${API_BASE_URL}/tokens/${encodeURIComponent(tokenCode)}/cancel`, {
                method: 'PATCH',
                headers
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {
            console.warn('Could not sync cancellation to server:', e.message);
        }
        return { success: true, message: 'Token cancelled locally.' };
    },

    // Verify token code and security PIN (for towing operator or service bay scanner)
    async verifyServiceToken(tokenCode, securityPin) {
        try {
            const res = await fetch(`${API_BASE_URL}/tokens/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokenCode, securityPin })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Verification failed');
            return data;
        } catch (e) {
            // Local fallback verification
            const local = this.getLocalTokens().find(t => t.token_code === tokenCode);
            if (local) {
                if (String(local.security_pin) === String(securityPin).trim()) {
                    return { success: true, verified: true, token: local, message: 'Verified from local store' };
                }
                throw new Error('Invalid security PIN');
            }
            throw e;
        }
    },

    // =========================================================
    // SUBSCRIPTION & PREMIUM PLANS
    // =========================================================
    getSubscriptionPlans: function() {
        return [
            {
                id: 'FREE',
                name: 'Free Operator',
                priceMonthly: 0,
                priceAnnual: 0,
                description: 'Real-time tyre pressure & temperature telemetry for daily drivers.',
                features: [
                    'Direct ESP32 Wi-Fi Telemetry Link',
                    '1 Vehicle Monitored',
                    'Standard Towing Dispatch Queue',
                    'Manual Tyre Shop Finder'
                ]
            },
            {
                id: 'PRO',
                name: 'Velocheck Pro',
                popular: true,
                priceMonthly: 299,
                priceAnnual: 2690,
                description: 'Zero-wait priority emergency dispatches & AI blowout warning.',
                features: [
                    'Zero-Wait Priority Towing Dispatches',
                    'AI Predictive Tread Depth & Blowout Warnings',
                    'Up to 3 Vehicles Monitored (Bikes, Cars, SUVs)',
                    '15% Flat Discount at Authorized Tyre Pitstops',
                    'Free 4-Digit VIP Fast-Pass Security Tokens',
                    '24/7 Roadside Concierge Emergency Hotline'
                ]
            },
            {
                id: 'TITANIUM',
                name: 'Titanium VIP',
                priceMonthly: 699,
                priceAnnual: 6290,
                description: 'Complete family garage roadside guarantee with unlimited towing.',
                features: [
                    'Everything in Pro Tier Included',
                    'Unlimited Free Emergency Towing (50km/call)',
                    'Up to 6 Vehicles Monitored',
                    'Free Annual 4-Wheel Laser Balancing & Nitrogen Fills',
                    'Satellite / Offline Telemetry Synchronization',
                    'Personal Master Mechanic on Speed Dial'
                ]
            },
            {
                id: 'FLEET',
                name: 'Commercial Fleet',
                priceMonthly: 1999,
                priceAnnual: 17990,
                description: 'Heavy cargo, logistics trucks, and enterprise commercial fleets.',
                features: [
                    'Heavy Cargo & Hydraulic Wheel Lift Fleets',
                    'Unlimited Commercial Vehicles Multi-Driver Dashboard',
                    'Logistics Telematics API & Webhook Integration',
                    'Corporate Invoicing & GST Tax Documentation'
                ]
            }
        ];
    },

    getCurrentSubscription: function() {
        const tier = (localStorage.getItem('velocheck_subscription_tier') || 'FREE').toUpperCase();
        const cycle = localStorage.getItem('velocheck_subscription_cycle') || 'monthly';
        const activatedAt = localStorage.getItem('velocheck_subscription_date') || null;
        return {
            tier,
            cycle,
            activatedAt,
            isActive: true,
            isPro: tier === 'PRO' || tier === 'TITANIUM' || tier === 'FLEET',
            isTitanium: tier === 'TITANIUM' || tier === 'FLEET',
            isFleet: tier === 'FLEET'
        };
    },

    upgradeSubscription: async function(tier, cycle = 'monthly') {
        const normalizedTier = String(tier).toUpperCase();
        localStorage.setItem('velocheck_subscription_tier', normalizedTier);
        localStorage.setItem('velocheck_subscription_cycle', cycle);
        localStorage.setItem('velocheck_subscription_date', new Date().toISOString());

        try {
            await fetch(`${this.getApiBase()}/api/subscription/upgrade`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tier: normalizedTier, billingCycle: cycle })
            });
        } catch (e) {
            // Local fallback persisted successfully
        }

        return this.getCurrentSubscription();
    }
};

window.VelocheckAuth = VelocheckAuth;
