// Lightweight, pure JS validation schemas for DairyERP inputs
// Zero dependencies, fully compatible with Cloudflare Workers / D1
import { VALID_STATUS_IDS } from './models/animalStatuses.js';

export function validateFarmInput(data) {
    const errors = [];
    if (!data || typeof data !== 'object') {
        return { isValid: false, errors: ['Request body must be a JSON object'] };
    }

    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) {
        errors.push('Farm name is required');
    } else if (name.length > 255) {
        errors.push('Farm name cannot exceed 255 characters');
    }

    if (data.phone && typeof data.phone === 'string') {
        const cleanPhone = data.phone.trim();
        if (cleanPhone.length > 50) {
            errors.push('Phone number cannot exceed 50 characters');
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        sanitized: {
            name,
            farmer_name: typeof data.farmer_name === 'string' ? data.farmer_name.trim() : null,
            city: typeof data.city === 'string' ? data.city.trim() : null,
            address: typeof data.address === 'string' ? data.address.trim() : null,
            phone: typeof data.phone === 'string' ? data.phone.trim() : null
        }
    };
}

export function validateAnimalInput(data) {
    const errors = [];
    if (!data || typeof data !== 'object') {
        return { isValid: false, errors: ['Animal record must be a JSON object'] };
    }

    const farmNumber = String(data.farm_number || data.number || '').trim();
    if (!farmNumber) {
        errors.push('Animal farm number (working number) is required');
    } else if (farmNumber.length > 50) {
        errors.push('Animal farm number cannot exceed 50 characters');
    }

    if (data.birth_date && isNaN(Date.parse(data.birth_date))) {
        errors.push('Invalid birth_date format (must be YYYY-MM-DD)');
    }

    if (data.last_calving_date && isNaN(Date.parse(data.last_calving_date))) {
        errors.push('Invalid last_calving_date format (must be YYYY-MM-DD)');
    }

    const currentStatus = data.current_status || 'Active';
    if (!VALID_STATUS_IDS.includes(currentStatus)) {
        errors.push(`Invalid animal status '${currentStatus}'. Allowed: ${VALID_STATUS_IDS.join(', ')}`);
    }

    return {
        isValid: errors.length === 0,
        errors,
        sanitized: {
            farm_number: farmNumber,
            official_tag: typeof data.official_tag === 'string' ? data.official_tag.trim() : null,
            name: typeof data.name === 'string' ? data.name.trim() : null,
            birth_date: data.birth_date || null,
            lactation_number: Number.isInteger(Number(data.lactation_number)) ? Number(data.lactation_number) : 0,
            current_status: currentStatus,
            last_calving_date: data.last_calving_date || null,
            expected_calving_date: data.expected_calving_date || null,
            group_name: typeof data.group_name === 'string' ? data.group_name.trim() : 'Група 1'
        }
    };
}

export function validateReproEventInput(data) {
    const errors = [];
    if (!data || typeof data !== 'object') {
        return { isValid: false, errors: ['Repro event must be a JSON object'] };
    }

    const validTypes = ['HEAT', 'INSEMINATION', 'PREGNANCY_CHECK', 'CALVING', 'DRY_OFF'];
    const eventType = String(data.event_type || '').toUpperCase().trim();
    if (!validTypes.includes(eventType)) {
        errors.push(`Invalid event_type '${data.event_type}'. Allowed: ${validTypes.join(', ')}`);
    }

    if (!data.event_date || isNaN(Date.parse(data.event_date))) {
        errors.push('event_date is required and must be a valid date');
    }

    return {
        isValid: errors.length === 0,
        errors,
        sanitized: {
            event_type: eventType,
            event_date: data.event_date,
            bull_code: typeof data.bull_code === 'string' ? data.bull_code.trim() : null,
            result: typeof data.result === 'string' ? data.result.trim() : null,
            notes: typeof data.notes === 'string' ? data.notes.trim() : null
        }
    };
}

export function validateHealthEventInput(data) {
    const errors = [];
    if (!data || typeof data !== 'object') {
        return { isValid: false, errors: ['Health event must be a JSON object'] };
    }

    const diagnosis = typeof data.diagnosis === 'string' ? data.diagnosis.trim() : '';
    if (!diagnosis) {
        errors.push('Diagnosis is required');
    }

    if (!data.event_date || isNaN(Date.parse(data.event_date))) {
        errors.push('event_date is required and must be a valid date (YYYY-MM-DD)');
    }

    return {
        isValid: errors.length === 0,
        errors,
        sanitized: {
            diagnosis,
            event_date: data.event_date,
            medication_name: typeof data.medication_name === 'string' ? data.medication_name.trim() : null,
            dosage: typeof data.dosage === 'string' ? data.dosage.trim() : null,
            milk_withholding_until: data.milk_withholding_until || null,
            meat_withholding_until: data.meat_withholding_until || null,
            is_active_withholding: Boolean(data.is_active_withholding) ? 1 : 0,
            notes: typeof data.notes === 'string' ? data.notes.trim() : null
        }
    };
}

