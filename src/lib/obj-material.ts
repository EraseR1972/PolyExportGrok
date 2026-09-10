export type ObjMaterial = {
  name: string;
  color: [number, number, number];
  roughness: number;
  metalness: number;
  opacity: number;
  mapName?: string;
  mapUrl?: string;
};
