/**
 * Web-compatible mock for react-native-maps using Leaflet.
 * This file is used when bundling for web platform via metro.config.js alias.
 * On Android/iOS, the real react-native-maps library is used instead.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Dynamically load Leaflet CSS on web
if (typeof document !== 'undefined') {
  if (!document.getElementById('leaflet-css')) {
    const link = document.createElement('link');
    link.id = 'leaflet-css';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }
}

// --- MapView (Main Map Component) ---
const MapView = (props) => {
  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markersRef = useRef([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const {
    style,
    initialRegion,
    region,
    onRegionChangeComplete,
    children,
    showsUserLocation,
    ...rest
  } = props;

  useEffect(() => {
    if (typeof window === 'undefined' || !mapRef.current) return;

    // Dynamic import of Leaflet to avoid SSR issues
    import('leaflet').then((L) => {
      if (leafletMapRef.current) return; // Already initialized

      const center = initialRegion || region || { latitude: 31.5204, longitude: 74.3587 };

      const map = L.map(mapRef.current, {
        center: [center.latitude, center.longitude],
        zoom: 13,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      leafletMapRef.current = map;
      setIsLoaded(true);

      if (onRegionChangeComplete) {
        map.on('moveend', () => {
          const c = map.getCenter();
          onRegionChangeComplete({
            latitude: c.lat,
            longitude: c.lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          });
        });
      }

      // Fix Leaflet's default icon path issue in bundlers
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });
    }).catch((e) => console.error('[WebMap] Failed to load Leaflet:', e));

    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, []);

  // Update map center when region prop changes
  useEffect(() => {
    if (!leafletMapRef.current || !region) return;
    leafletMapRef.current.setView([region.latitude, region.longitude], leafletMapRef.current.getZoom(), { animate: true });
  }, [region?.latitude, region?.longitude]);

  return (
    <View style={[styles.container, style]}>
      <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: 300 }} />
      {/* Render children (Markers) with map context */}
      {isLoaded && leafletMapRef.current && React.Children.map(children, (child) => {
        if (!child) return null;
        return React.cloneElement(child, { _map: leafletMapRef.current });
      })}
    </View>
  );
};

// --- Marker Component ---
export const Marker = (props) => {
  const { coordinate, title, description, pinColor, _map, children } = props;
  const markerRef = useRef(null);

  useEffect(() => {
    if (!_map || !coordinate) return;

    import('leaflet').then((L) => {
      if (markerRef.current) {
        markerRef.current.remove();
      }

      const color = pinColor || '#e74c3c';
      
      // Custom colored marker using SVG
      const svgIcon = L.divIcon({
        html: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">
          <path fill="${color}" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z"/>
          <circle fill="white" cx="12" cy="12" r="5"/>
        </svg>`,
        className: '',
        iconSize: [24, 36],
        iconAnchor: [12, 36],
        popupAnchor: [0, -36],
      });

      const marker = L.marker([coordinate.latitude, coordinate.longitude], { icon: svgIcon }).addTo(_map);

      if (title || description) {
        marker.bindPopup(`<b>${title || ''}</b><br/>${description || ''}`);
      }

      markerRef.current = marker;
    });

    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  }, [_map, coordinate?.latitude, coordinate?.longitude, title, pinColor]);

  return null;
};

// --- Other Exports (stubs for web compatibility) ---
export const Callout = ({ children }) => null;
export const Circle = () => null;
export const Polyline = () => null;
export const Polygon = () => null;

export class AnimatedRegion {
  constructor(value) { this.value = value; }
  setValue() {}
  timing() { return { start: () => {} }; }
  spring() { return { start: () => {} }; }
}

export const Animated = MapView;
export const PROVIDER_GOOGLE = 'google';
export const PROVIDER_DEFAULT = null;

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});

export default MapView;
