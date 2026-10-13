import { useQuery } from '@tanstack/react-query';
import { get } from './api';
import type { Account, PaymentMethod, RatePlan, Room, RoomStatus, RoomType, Staff, TransactionCode } from './types';

// Sık kullanılan tanım listeleri. Değişiklikler sunucudan gelen anlık bildirimle yenilenir.
export const useRoomTypes = () => useQuery({ queryKey: ['rooms', 'types'], queryFn: () => get<RoomType[]>('/api/v1/room-types') });
export const useRooms = () => useQuery({ queryKey: ['rooms', 'list'], queryFn: () => get<Room[]>('/api/v1/rooms') });
export const useRoomStatus = () => useQuery({ queryKey: ['roomStatus'], queryFn: () => get<RoomStatus[]>('/api/v1/rooms/status') });
export const useRatePlans = () => useQuery({ queryKey: ['ratePlans'], queryFn: () => get<RatePlan[]>('/api/v1/rate-plans') });
export const useCompanies = () => useQuery({ queryKey: ['accounts', 'companies'], queryFn: () => get<Account[]>('/api/v1/companies?active=true') });
export const useAgencies = () => useQuery({ queryKey: ['accounts', 'agencies'], queryFn: () => get<Account[]>('/api/v1/agencies?active=true') });
export const useTransactionCodes = () => useQuery({ queryKey: ['settings', 'tcodes'], queryFn: () => get<TransactionCode[]>('/api/v1/finance/transaction-codes') });
export const usePaymentMethods = () => useQuery({ queryKey: ['settings', 'pmethods'], queryFn: () => get<PaymentMethod[]>('/api/v1/finance/payment-methods') });
export const useStaff = () => useQuery({ queryKey: ['hk', 'staff'], queryFn: () => get<Staff[]>('/api/v1/housekeeping/staff') });
