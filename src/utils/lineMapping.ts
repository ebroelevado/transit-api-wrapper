import { LineMapping } from '../types';

const MAP: Record<string, LineMapping> = {
  '1':   { publicId:'1',   legacyId:'1',   scheduleId:'1',   normalized:1 },
  '2':   { publicId:'2',   legacyId:'2',   scheduleId:'2',   normalized:2 },
  '3':   { publicId:'3',   legacyId:'3',   scheduleId:'3',   normalized:3 },
  '4':   { publicId:'4',   legacyId:'4',   scheduleId:'4',   normalized:4 },
  '11':  { publicId:'11',  legacyId:'11',  scheduleId:'11',  normalized:11 },
  '12':  { publicId:'12',  legacyId:'12',  scheduleId:'12',  normalized:12 },
  '13':  { publicId:'13',  legacyId:'13',  scheduleId:'13',  normalized:13 },
  '14':  { publicId:'14',  legacyId:'14',  scheduleId:'14',  normalized:14 },
  '15':  { publicId:'15',  legacyId:'15',  scheduleId:'15',  normalized:15 },
  '16':  { publicId:'16',  legacyId:'16',  scheduleId:'16',  normalized:16 },
  '17':  { publicId:'17',  legacyId:'17',  scheduleId:'17',  normalized:17 },
  '18':  { publicId:'18',  legacyId:'18',  scheduleId:'18',  normalized:18 },
  'LC':  { publicId:'LC',  legacyId:'LC',  scheduleId:'C',   normalized:100 },
  'N1':  { publicId:'N1',  legacyId:'N1',  scheduleId:'101', normalized:101 },
  'N2':  { publicId:'N2',  legacyId:'N2',  scheduleId:'102', normalized:102 },
  'N3':  { publicId:'N3',  legacyId:'N3',  scheduleId:'103', normalized:103 },
  '6C1': { publicId:'6C1', legacyId:'6C1', scheduleId:'61',  normalized:61 },
  '6C2': { publicId:'6C2', legacyId:'6C2', scheduleId:'62',  normalized:62 },
  '7C1': { publicId:'7C1', legacyId:'7C1', scheduleId:'71',  normalized:71 },
  '7C2': { publicId:'7C2', legacyId:'7C2', scheduleId:'72',  normalized:72 },
  '24C1':{ publicId:'24C1',legacyId:'24C1',scheduleId:'241', normalized:241 },
  '24C2':{ publicId:'24C2',legacyId:'24C2',scheduleId:'242', normalized:242 },
  'E1':  { publicId:'E1',  legacyId:'E1',  scheduleId:null,  normalized:41 },
  'E31': { publicId:'E31', legacyId:'E31', scheduleId:null,  normalized:31 },
};

export function getMapping(id: string): LineMapping | undefined { return MAP[id]; }
export function toLegacyId(id: string): string { return MAP[id]?.legacyId ?? id; }
export function toScheduleId(id: string): string | null { return MAP[id]?.scheduleId ?? id; }
export function allPublicIds(): string[] { return Object.keys(MAP); }
export function lineName(id: string): string { return `Línea ${id}`; }

const TEXT_COLORS: Record<string, string> = { '17': 'black', '18': 'black' };
export function getTextColor(id: string): string { return TEXT_COLORS[id] || 'white'; }

export function getDayType(d?: Date): 'L' | 'S' | 'F' {
  const day = (d || new Date()).getDay();
  if (day === 0) return 'F';
  if (day === 6) return 'S';
  return 'L';
}

export function dayTypeName(d: string): string {
  return { L: 'Laborables', S: 'Sábados', F: 'Festivos' }[d] || 'Desconocido';
}
