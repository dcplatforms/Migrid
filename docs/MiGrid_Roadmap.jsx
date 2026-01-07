import React, { useState } from 'react';
import { CheckCircle, Circle, Clock, Zap, Shield, Server, Cpu, Wallet, Users, BarChart3, Radio, Building2, ShoppingCart, ChevronDown, ChevronRight, ExternalLink, GitBranch } from 'lucide-react';

const layerIcons = {
  L1: Cpu,
  L2: Radio,
  L3: BarChart3,
  L4: BarChart3,
  L5: Users,
  L6: Users,
  L7: Server,
  L8: Building2,
  L9: ShoppingCart,
  L10: Wallet
};

const statusColors = {
  complete: { bg: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500' },
  inProgress: { bg: 'bg-amber-500', text: 'text-amber-400', border: 'border-amber-500' },
  planned: { bg: 'bg-slate-600', text: 'text-slate-400', border: 'border-slate-600' },
  future: { bg: 'bg-slate-700', text: 'text-slate-500', border: 'border-slate-700' }
};

const phases = [
  {
    id: 'phase1',
    name: 'Foundation',
    version: 'v1.0',
    quarter: 'Q1 2025',
    status: 'complete',
    description: 'Core infrastructure and physics verification',
    releases: [
      {
        version: 'v1.0.0',
        name: 'Genesis Release',
        date: 'Jan 2025',
        status: 'complete',
        features: [
          { layer: 'L1', name: 'Physics Engine Core', description: 'Variance calculation with <15% threshold', status: 'complete' },
          { layer: 'L1', name: 'Vehicle Physics Database', description: '2025 model specs (F-150 Lightning, Rivian R1T, etc.)', status: 'complete' },
          { layer: 'L7', name: 'OCPP 1.6 Support', description: 'Basic charger communication protocol', status: 'complete' },
          { layer: 'L8', name: 'Energy Manager MVP', description: 'Modbus load monitoring, basic DLM', status: 'complete' }
        ]
      },
      {
        version: 'v1.1.0',
        name: 'Admin Portal Alpha',
        date: 'Feb 2025',
        status: 'complete',
        features: [
          { layer: 'L5', name: 'Fleet Portal Web', description: 'React + FluentUI admin dashboard', status: 'complete' },
          { layer: 'L8', name: 'Live Site Energy Dashboard', description: 'Real-time load visualization with Chart.js', status: 'complete' },
          { layer: 'L10', name: 'Token Engine Foundation', description: 'Kafka consumer, reward rules engine', status: 'complete' }
        ]
      }
    ]
  },
  {
    id: 'phase2',
    name: 'Grid Integration',
    version: 'v2.0',
    quarter: 'Q2 2025',
    status: 'inProgress',
    description: 'OpenADR 3.0 and utility program connectivity',
    releases: [
      {
        version: 'v2.0.0',
        name: 'Grid Signal Release',
        date: 'Apr 2025',
        status: 'inProgress',
        features: [
          { layer: 'L2', name: 'OpenADR 3.0 VEN', description: 'Virtual End Node implementation per spec', status: 'inProgress' },
          { layer: 'L2', name: 'Price Signal Ingestion', description: 'Day-ahead and real-time pricing events', status: 'inProgress' },
          { layer: 'L2', name: 'Demand Response Events', description: 'Load shed, CPP, VPP event handling', status: 'planned' },
          { layer: 'L7', name: 'OCPP 2.0.1 Upgrade', description: 'Smart charging profiles, ISO 15118 prep', status: 'planned' }
        ]
      },
      {
        version: 'v2.1.0',
        name: 'Telematics Bridge',
        date: 'May 2025',
        status: 'planned',
        features: [
          { layer: 'L1', name: 'Samsara Integration', description: 'Real-time vehicle SoC via Fleet Admin API', status: 'planned' },
          { layer: 'L1', name: 'Geotab Integration', description: 'Telematics webhook ingestion', status: 'planned' },
          { layer: 'L1', name: 'Fleetio Integration', description: 'Asset mapping and driver assignment', status: 'planned' }
        ]
      }
    ]
  },
  {
    id: 'phase3',
    name: 'Market Access',
    version: 'v3.0',
    quarter: 'Q3 2025',
    status: 'planned',
    description: 'VPP aggregation and wholesale market bidding',
    releases: [
      {
        version: 'v3.0.0',
        name: 'VPP Aggregator',
        date: 'Jul 2025',
        status: 'planned',
        features: [
          { layer: 'L3', name: 'Fleet Capacity Aggregation', description: 'Real-time available kW/kWh calculation', status: 'planned' },
          { layer: 'L3', name: 'BESS Integration', description: 'Stationary storage coordination', status: 'planned' },
          { layer: 'L3', name: 'Availability Forecasting', description: 'ML-based vehicle availability prediction', status: 'planned' }
        ]
      },
      {
        version: 'v3.1.0',
        name: 'Market Gateway Alpha',
        date: 'Aug 2025',
        status: 'planned',
        features: [
          { layer: 'L4', name: 'CAISO Adapter', description: 'Day-ahead and real-time market bidding', status: 'planned' },
          { layer: 'L4', name: 'PJM Adapter', description: 'Regulation and capacity market integration', status: 'planned' },
          { layer: 'L4', name: 'LMP Optimization', description: 'Locational marginal pricing arbitrage', status: 'planned' }
        ]
      }
    ]
  },
  {
    id: 'phase4',
    name: 'Driver Experience',
    version: 'v4.0',
    quarter: 'Q4 2025',
    status: 'future',
    description: 'Mobile app and driver reward ecosystem',
    releases: [
      {
        version: 'v4.0.0',
        name: 'Driver App Launch',
        date: 'Oct 2025',
        status: 'future',
        features: [
          { layer: 'L5', name: 'React Native Mobile App', description: 'iOS and Android driver interface', status: 'future' },
          { layer: 'L5', name: 'Smart Routing', description: 'Optimal charging location recommendations', status: 'future' },
          { layer: 'L5', name: 'Voice Commands', description: 'Hands-free charging session control', status: 'future' }
        ]
      },
      {
        version: 'v4.1.0',
        name: 'Reward Ecosystem',
        date: 'Nov 2025',
        status: 'future',
        features: [
          { layer: 'L10', name: 'Open-Wallet Integration', description: 'Token minting and redemption', status: 'future' },
          { layer: 'L10', name: '$GRID Token Launch', description: 'ERC-20 on Polygon mainnet', status: 'future' },
          { layer: 'L6', name: 'Gamification Engine', description: 'Leaderboards, achievements, bonuses', status: 'future' }
        ]
      }
    ]
  },
  {
    id: 'phase5',
    name: 'Enterprise Scale',
    version: 'v5.0',
    quarter: 'Q1 2026',
    status: 'future',
    description: 'Multi-site, multi-fleet orchestration',
    releases: [
      {
        version: 'v5.0.0',
        name: 'Enterprise Platform',
        date: 'Jan 2026',
        status: 'future',
        features: [
          { layer: 'L9', name: 'Commerce Engine', description: 'Flexible billing, tariffs, split-billing', status: 'future' },
          { layer: 'L7', name: 'ISO 15118 Plug & Charge', description: 'Certificate-based vehicle authentication', status: 'future' },
          { layer: 'L7', name: 'OCPI 2.2 Roaming', description: 'Cross-network charging orchestration', status: 'future' }
        ]
      },
      {
        version: 'v5.1.0',
        name: 'Global Markets',
        date: 'Mar 2026',
        status: 'future',
        features: [
          { layer: 'L4', name: 'ENTSO-E Adapter', description: 'European market integration', status: 'future' },
          { layer: 'L4', name: 'Nord Pool Adapter', description: 'Nordic zonal pricing support', status: 'future' },
          { layer: 'L8', name: 'Edge Runtime v2', description: 'Multi-site orchestration, mesh networking', status: 'future' }
        ]
      }
    ]
  }
];

const layerDescriptions = {
  L1: { name: 'Physics Engine', color: 'bg-cyan-500' },
  L2: { name: 'Grid Signal', color: 'bg-green-500' },
  L3: { name: 'VPP Aggregator', color: 'bg-blue-500' },
  L4: { name: 'Market Gateway', color: 'bg-purple-500' },
  L5: { name: 'Driver DX', color: 'bg-pink-500' },
  L6: { name: 'Engagement', color: 'bg-rose-500' },
  L7: { name: 'Device Gateway', color: 'bg-orange-500' },
  L8: { name: 'Energy Manager', color: 'bg-yellow-500' },
  L9: { name: 'Commerce', color: 'bg-teal-500' },
  L10: { name: 'Token Bridge', color: 'bg-indigo-500' }
};

function StatusIcon({ status }) {
  if (status === 'complete') return <CheckCircle className="w-4 h-4 text-emerald-400" />;
  if (status === 'inProgress') return <Clock className="w-4 h-4 text-amber-400" />;
  return <Circle className="w-4 h-4 text-slate-500" />;
}

function LayerBadge({ layer }) {
  const Icon = layerIcons[layer] || Server;
  const info = layerDescriptions[layer];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono ${info.color} bg-opacity-20 text-white`}>
      <Icon className="w-3 h-3" />
      {layer}
    </span>
  );
}

function FeatureItem({ feature }) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg bg-slate-800/50 border-l-2 ${statusColors[feature.status].border}`}>
      <StatusIcon status={feature.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <LayerBadge layer={feature.layer} />
          <span className="font-medium text-white text-sm">{feature.name}</span>
        </div>
        <p className="text-slate-400 text-xs mt-1">{feature.description}</p>
      </div>
    </div>
  );
}

function ReleaseCard({ release, isExpanded, onToggle }) {
  return (
    <div className="bg-slate-800/30 rounded-lg border border-slate-700">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-700/30 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${statusColors[release.status].bg}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-cyan-400 text-sm">{release.version}</span>
              <span className="font-semibold text-white">{release.name}</span>
            </div>
            <span className="text-slate-500 text-xs">{release.date}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded ${statusColors[release.status].bg} bg-opacity-20 ${statusColors[release.status].text}`}>
            {release.features.filter(f => f.status === 'complete').length}/{release.features.length} complete
          </span>
          {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        </div>
      </button>
      {isExpanded && (
        <div className="px-4 pb-4 space-y-2">
          {release.features.map((feature, idx) => (
            <FeatureItem key={idx} feature={feature} />
          ))}
        </div>
      )}
    </div>
  );
}

function PhaseCard({ phase, expandedReleases, setExpandedReleases }) {
  const [isExpanded, setIsExpanded] = useState(phase.status === 'inProgress');
  
  const totalFeatures = phase.releases.reduce((sum, r) => sum + r.features.length, 0);
  const completedFeatures = phase.releases.reduce(
    (sum, r) => sum + r.features.filter(f => f.status === 'complete').length, 0
  );
  const progress = totalFeatures > 0 ? (completedFeatures / totalFeatures) * 100 : 0;

  return (
    <div className={`relative bg-slate-900/50 rounded-xl border ${statusColors[phase.status].border} overflow-hidden`}>
      {/* Progress bar */}
      <div className="absolute top-0 left-0 h-1 bg-slate-700 w-full">
        <div 
          className={`h-full ${statusColors[phase.status].bg} transition-all duration-500`}
          style={{ width: `${progress}%` }}
        />
      </div>
      
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-5 text-left hover:bg-slate-800/30 transition-colors"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-lg ${statusColors[phase.status].bg} bg-opacity-20 flex items-center justify-center`}>
              <Zap className={`w-6 h-6 ${statusColors[phase.status].text}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white">{phase.name}</h3>
                <span className="font-mono text-cyan-400 text-sm">{phase.version}</span>
              </div>
              <p className="text-slate-400 text-sm mt-1">{phase.description}</p>
              <div className="flex items-center gap-3 mt-2">
                <span className={`text-xs px-2 py-1 rounded ${statusColors[phase.status].bg} bg-opacity-20 ${statusColors[phase.status].text}`}>
                  {phase.quarter}
                </span>
                <span className="text-slate-500 text-xs">
                  {completedFeatures}/{totalFeatures} features complete
                </span>
              </div>
            </div>
          </div>
          {isExpanded ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
        </div>
      </button>

      {isExpanded && (
        <div className="px-5 pb-5 space-y-3">
          {phase.releases.map((release) => (
            <ReleaseCard
              key={release.version}
              release={release}
              isExpanded={expandedReleases[release.version]}
              onToggle={() => setExpandedReleases(prev => ({
                ...prev,
                [release.version]: !prev[release.version]
              }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LayerProgress() {
  const layerStats = {};
  Object.keys(layerDescriptions).forEach(layer => {
    layerStats[layer] = { total: 0, complete: 0 };
  });
  
  phases.forEach(phase => {
    phase.releases.forEach(release => {
      release.features.forEach(feature => {
        layerStats[feature.layer].total++;
        if (feature.status === 'complete') {
          layerStats[feature.layer].complete++;
        }
      });
    });
  });

  return (
    <div className="bg-slate-900/50 rounded-xl border border-slate-700 p-5">
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <GitBranch className="w-5 h-5 text-cyan-400" />
        Layer Development Progress
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(layerDescriptions).map(([layer, info]) => {
          const stats = layerStats[layer];
          const progress = stats.total > 0 ? (stats.complete / stats.total) * 100 : 0;
          const Icon = layerIcons[layer];
          return (
            <div key={layer} className="bg-slate-800/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-6 h-6 rounded ${info.color} bg-opacity-20 flex items-center justify-center`}>
                  <Icon className={`w-3 h-3 ${info.color.replace('bg-', 'text-')}`} />
                </div>
                <span className="font-mono text-xs text-slate-400">{layer}</span>
              </div>
              <div className="text-xs text-slate-500 mb-1">{info.name}</div>
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className={`h-full ${info.color} transition-all duration-500`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-xs text-slate-500 mt-1">{stats.complete}/{stats.total}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineView() {
  return (
    <div className="bg-slate-900/50 rounded-xl border border-slate-700 p-5">
      <h3 className="text-lg font-bold text-white mb-4">Release Timeline</h3>
      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-700" />
        
        <div className="space-y-4">
          {phases.flatMap(phase => 
            phase.releases.map(release => (
              <div key={release.version} className="relative flex items-start gap-4 pl-10">
                <div className={`absolute left-2.5 w-3 h-3 rounded-full ${statusColors[release.status].bg} ring-4 ring-slate-900`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-cyan-400 text-sm">{release.version}</span>
                    <span className="font-medium text-white text-sm">{release.name}</span>
                    <span className="text-slate-500 text-xs">• {release.date}</span>
                  </div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {[...new Set(release.features.map(f => f.layer))].map(layer => (
                      <LayerBadge key={layer} layer={layer} />
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function MiGridRoadmap() {
  const [expandedReleases, setExpandedReleases] = useState({
    'v2.0.0': true // Current in-progress release expanded by default
  });
  const [view, setView] = useState('phases');

  const totalFeatures = phases.reduce(
    (sum, p) => sum + p.releases.reduce((s, r) => s + r.features.length, 0), 0
  );
  const completedFeatures = phases.reduce(
    (sum, p) => sum + p.releases.reduce((s, r) => s + r.features.filter(f => f.status === 'complete').length, 0), 0
  );
  const inProgressFeatures = phases.reduce(
    (sum, p) => sum + p.releases.reduce((s, r) => s + r.features.filter(f => f.status === 'inProgress').length, 0), 0
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Zap className="w-8 h-8 text-cyan-400" />
            <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-teal-400 bg-clip-text text-transparent">
              MiGrid Product Roadmap
            </h1>
          </div>
          <p className="text-slate-400">The Operating System for Sustainable Fleet Electrification</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-emerald-400">{completedFeatures}</div>
            <div className="text-sm text-slate-400">Features Complete</div>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-amber-400">{inProgressFeatures}</div>
            <div className="text-sm text-slate-400">In Progress</div>
          </div>
          <div className="bg-slate-500/10 border border-slate-500/30 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-slate-400">{totalFeatures - completedFeatures - inProgressFeatures}</div>
            <div className="text-sm text-slate-400">Planned</div>
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => setView('phases')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              view === 'phases' ? 'bg-cyan-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            Phase View
          </button>
          <button
            onClick={() => setView('timeline')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              view === 'timeline' ? 'bg-cyan-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            Timeline View
          </button>
          <button
            onClick={() => setView('layers')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              view === 'layers' ? 'bg-cyan-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            Layer Progress
          </button>
        </div>

        {/* Content */}
        {view === 'phases' && (
          <div className="space-y-4">
            {phases.map(phase => (
              <PhaseCard
                key={phase.id}
                phase={phase}
                expandedReleases={expandedReleases}
                setExpandedReleases={setExpandedReleases}
              />
            ))}
          </div>
        )}

        {view === 'timeline' && <TimelineView />}
        
        {view === 'layers' && <LayerProgress />}

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 text-sm text-slate-500 pt-4 border-t border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span>Complete</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span>In Progress</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-slate-600" />
            <span>Planned</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-slate-700" />
            <span>Future</span>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-slate-600 pt-4">
          MiGrid v10.0.0 • Apache 2.0 License • Updated {new Date().toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}
