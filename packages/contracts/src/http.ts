import { z } from 'zod';

import { chainStepSchema } from './chain.js';
import {
  appointmentStatusSchema,
  resourceTypeSchema,
  segmentKindSchema,
} from './enums.js';

/** Calendar date as `YYYY-MM-DD`. Clinic-local; never a timestamp. */
export const clinicDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a calendar date as YYYY-MM-DD');

export type ClinicDate = z.infer<typeof clinicDateSchema>;

/** An instant on the wire: ISO-8601 with an offset or Z. */
export const instantSchema = z.iso.datetime({ offset: true });

export type Instant = z.infer<typeof instantSchema>;

// ---------------------------------------------------------------------------
// Placements and candidates — human-readable times for the receptionist
// ---------------------------------------------------------------------------

export const placementSchema = z.object({
  seq: z.number().int().positive(),
  kind: segmentKindSchema,
  resourceId: z.uuid().nullable(),
  patientStart: instantSchema,
  patientEnd: instantSchema,
  resourceStart: instantSchema.nullable(),
  resourceEnd: instantSchema.nullable(),
});

export type PlacementDto = z.infer<typeof placementSchema>;

export const candidateSchema = z.object({
  start: instantSchema,
  end: instantSchema,
  spanMinutes: z.number().int().nonnegative(),
  incidentalGapMinutes: z.number().int().nonnegative(),
  placements: z.array(placementSchema),
});

export type CandidateDto = z.infer<typeof candidateSchema>;

// ---------------------------------------------------------------------------
// Schedule grid
// ---------------------------------------------------------------------------

export const getScheduleQuerySchema = z.object({
  date: clinicDateSchema,
});

export type GetScheduleQuery = z.infer<typeof getScheduleQuerySchema>;

export const scheduleResourceSchema = z.object({
  id: z.uuid(),
  type: resourceTypeSchema,
  name: z.string(),
  modalities: z.array(z.string()),
  displayOrder: z.number().int(),
});

export const scheduleLaneSchema = z.object({
  /** Resource id, or `patient:<uuid>` for a patient lane. */
  key: z.string(),
  kind: z.enum(['RESOURCE', 'PATIENT']),
  resourceId: z.uuid().optional(),
  patientId: z.uuid().optional(),
  label: z.string(),
});

export const scheduleSegmentSchema = z.object({
  id: z.uuid(),
  appointmentId: z.uuid(),
  seq: z.number().int().positive(),
  kind: segmentKindSchema,
  resourceId: z.uuid().nullable(),
  patientId: z.uuid(),
  patientStart: instantSchema,
  patientEnd: instantSchema,
  resourceStart: instantSchema.nullable(),
  resourceEnd: instantSchema.nullable(),
  status: z.enum(['ACTIVE', 'CANCELLED']),
});

export const scheduleAppointmentSchema = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  status: appointmentStatusSchema,
  templateId: z.uuid().nullable(),
  templateNameAtBooking: z.string().nullable(),
  notes: z.string().nullable(),
  segments: z.array(scheduleSegmentSchema),
});

export const getScheduleResponseSchema = z.object({
  date: clinicDateSchema,
  scheduleVersion: z.number().int().positive(),
  slotMinutes: z.number().int().positive(),
  /** IANA timezone of the clinic; used to label the time gutter. */
  timezone: z.string().min(1),
  dayStart: instantSchema,
  dayEnd: instantSchema,
  resources: z.array(scheduleResourceSchema),
  lanes: z.array(scheduleLaneSchema),
  appointments: z.array(scheduleAppointmentSchema),
});

export type GetScheduleResponse = z.infer<typeof getScheduleResponseSchema>;
export type ScheduleAppointment = z.infer<typeof scheduleAppointmentSchema>;
export type ScheduleSegment = z.infer<typeof scheduleSegmentSchema>;

// ---------------------------------------------------------------------------
// Suggestions and booking
// ---------------------------------------------------------------------------

export const suggestAppointmentsBodySchema = z.object({
  patientId: z.uuid(),
  date: clinicDateSchema,
  steps: z.array(chainStepSchema).min(1),
  templateId: z.uuid().optional(),
  earliestStart: instantSchema.optional(),
  latestEnd: instantSchema.optional(),
});

export type SuggestAppointmentsBody = z.infer<
  typeof suggestAppointmentsBodySchema
>;

export const suggestAppointmentsResponseSchema = z.object({
  scheduleVersion: z.number().int().positive(),
  candidates: z.array(candidateSchema),
});

export type SuggestAppointmentsResponse = z.infer<
  typeof suggestAppointmentsResponseSchema
>;

/**
 * The candidate a receptionist chose, echoed back on book/reschedule so the
 * server can re-validate it against the current day rather than trusting the
 * client's slot arithmetic.
 */
export const chosenCandidateSchema = candidateSchema;

export const bookAppointmentBodySchema = z.object({
  patientId: z.uuid(),
  date: clinicDateSchema,
  steps: z.array(chainStepSchema).min(1),
  templateId: z.uuid().optional(),
  candidate: chosenCandidateSchema,
  scheduleVersion: z.number().int().positive(),
  notes: z.string().max(2000).optional(),
});

export type BookAppointmentBody = z.infer<typeof bookAppointmentBodySchema>;

export const bookedSegmentSchema = z.object({
  id: z.uuid(),
  seq: z.number().int().positive(),
  kind: segmentKindSchema,
  resourceId: z.uuid().nullable(),
  patientStart: instantSchema,
  patientEnd: instantSchema,
  resourceStart: instantSchema.nullable(),
  resourceEnd: instantSchema.nullable(),
});

export const bookAppointmentResponseSchema = z.object({
  appointmentId: z.uuid(),
  status: appointmentStatusSchema,
  scheduleVersion: z.number().int().positive(),
  segments: z.array(bookedSegmentSchema),
});

export type BookAppointmentResponse = z.infer<
  typeof bookAppointmentResponseSchema
>;

export const rescheduleAppointmentBodySchema = z.object({
  candidate: chosenCandidateSchema,
  scheduleVersion: z.number().int().positive(),
});

export type RescheduleAppointmentBody = z.infer<
  typeof rescheduleAppointmentBodySchema
>;

export const cancelAppointmentBodySchema = z.object({
  reason: z.string().max(500).optional(),
});

export type CancelAppointmentBody = z.infer<typeof cancelAppointmentBodySchema>;

export const listAppointmentsQuerySchema = z.object({
  date: clinicDateSchema.optional(),
  status: appointmentStatusSchema.optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.string().optional(),
});

export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

export const appointmentDetailSchema = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  onDate: clinicDateSchema,
  status: appointmentStatusSchema,
  templateId: z.uuid().nullable(),
  templateNameAtBooking: z.string().nullable(),
  notes: z.string().nullable(),
  steps: z.array(chainStepSchema),
  segments: z.array(bookedSegmentSchema),
  scheduleVersion: z.number().int().positive(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
});

export type AppointmentDetail = z.infer<typeof appointmentDetailSchema>;

export const listAppointmentsResponseSchema = z.object({
  items: z.array(appointmentDetailSchema),
  nextCursor: z.string().nullable(),
});

export type ListAppointmentsResponse = z.infer<
  typeof listAppointmentsResponseSchema
>;

// ---------------------------------------------------------------------------
// Patients, resources, service types, templates
// ---------------------------------------------------------------------------

export const listPatientsQuerySchema = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type ListPatientsQuery = z.infer<typeof listPatientsQuerySchema>;

export const createPatientBodySchema = z.object({
  mrn: z.string().min(1).max(64),
  fullName: z.string().min(1).max(200),
  dateOfBirth: clinicDateSchema.optional(),
  phone: z.string().max(40).optional(),
});

export type CreatePatientBody = z.infer<typeof createPatientBodySchema>;

export const patientSchema = z.object({
  id: z.uuid(),
  mrn: z.string(),
  fullName: z.string(),
  dateOfBirth: clinicDateSchema.nullable(),
  phone: z.string().nullable(),
  createdAt: instantSchema,
});

export type PatientDto = z.infer<typeof patientSchema>;

export const resourceDtoSchema = z.object({
  id: z.uuid(),
  type: resourceTypeSchema,
  name: z.string(),
  modalities: z.array(z.string()),
  displayOrder: z.number().int(),
  active: z.boolean(),
});

export type ResourceDto = z.infer<typeof resourceDtoSchema>;

export const serviceTypeDtoSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  resourceType: resourceTypeSchema,
  requiredModality: z.string().nullable(),
});

export type ServiceTypeDto = z.infer<typeof serviceTypeDtoSchema>;

export const appointmentTemplateSummarySchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  isPreset: z.boolean(),
  active: z.boolean(),
});

export const appointmentTemplateDetailSchema =
  appointmentTemplateSummarySchema.extend({
    steps: z.array(chainStepSchema),
  });

export type AppointmentTemplateDetail = z.infer<
  typeof appointmentTemplateDetailSchema
>;

export const createAppointmentTemplateBodySchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  steps: z.array(chainStepSchema).min(1),
});

export type CreateAppointmentTemplateBody = z.infer<
  typeof createAppointmentTemplateBodySchema
>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export const readyResponseSchema = z.object({
  status: z.literal('ready'),
});

/**
 * RFC 9457 problem details. `freshCandidates` is present on slot conflicts so
 * the receptionist can pick an alternative without starting over.
 */
export const problemDetailsSchema = z.object({
  type: z.url(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  instance: z.string().optional(),
  freshCandidates: z.array(candidateSchema).optional(),
  issues: z
    .array(
      z.object({
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string(),
      }),
    )
    .optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
