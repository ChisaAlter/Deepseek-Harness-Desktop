'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PHYSICS_JS = path.join(__dirname, 'pet-physics.js');
const SOURCE = fs.readFileSync(PHYSICS_JS, 'utf8');

function loadPhysics() {
  const context = vm.createContext({});
  vm.runInContext(SOURCE, context, { filename: 'pet-physics.js' });
  return context.PetPhysics;
}

const P = loadPhysics();

// Objects created inside the vm context carry that realm's Object/Array
// prototypes, so deepStrictEqual against test-realm literals fails on
// prototype identity. Reify through JSON before deep-comparing.
const reify = (o) => JSON.parse(JSON.stringify(o));

// Golden fixture: every "out" value below was produced by running the actual
// reference implementation (pet/physics.py, CPython 3.12) — see the throwaway
// generator gen_physics_fixture.py. Baked inline so the test has no runtime
// dependency on the Python clone.
const FIXTURE = {
  "constants": {
    "SPRING_K": 200,
    "SPRING_C": 30,
    "TRAIL_KEEP_SEC": 0.15,
    "RELEASE_WINDOW_SEC": 0.12,
    "RELEASE_STALE_SEC": 0.15,
    "MIN_SPAN_SEC": 0.02,
    "SEG_MIN_DT": 0.008,
    "DEAD_ZONE_SPEED": 500,
    "MAX_THROW_SPEED": 6000,
    "PEAK_WEIGHT": 0.5,
    "ACCEL_REF": 8000,
    "ACCEL_GAIN_MAX": 0.6,
    "THROW_STRENGTH_CAPS": {"gentle":3600,"standard":4800,"strong":7200,"crazy":9000},
    "SLINGSHOT_MIN_DISTANCE": 24,
    "SLINGSHOT_MAX_DISTANCE": 160,
    "SLINGSHOT_BASE_SPEED": 900,
    "SLINGSHOT_MAX_DEFORMATION": 1.3,
    "GRAVITY": 1400,
    "RESTITUTION": 0.78,
    "GROUND_FRICTION": 2.5,
    "REST_VY": 40,
    "REST_VX": 15
  },
  "springVelocity": [
    {"args":[0,0,100,0.016,200,30],"out":320},
    {"args":[50,30,100,0.008,200,30],"out":150},
    {"args":[-200,500,100,0.033,200,30],"out":-2642},
    {"args":[10,0,-50,0.016,150,20],"out":-113.2},
    {"args":[0,100,100,0.016,200,30],"out":0},
    {"args":[300,0,0,0.001,200,30],"out":291},
    {"args":[123.4,-45.6,78.9,0,200,30],"out":123.4}
  ],
  "estimateReleaseVelocity": [
    {
      "name": "flick",
      "trail": [
        [9.88,100,200],
        [9.888,142,203],
        [9.896,188,206],
        [9.904,238,209],
        [9.912,292,212],
        [9.92,350,215],
        [9.928,412,218],
        [9.936,478,221],
        [9.944,548,224],
        [9.952,622,227],
        [9.96,700,230],
        [9.968,782,233],
        [9.976,868,236],
        [9.984,958,239],
        [9.992,1052,242],
        [10,1150,245]
      ],
      "now": 10,
      "cap": 6000,
      "out": [5592.393164297325,239.6739927555996]
    },
    {
      "name": "flick-custom-cap",
      "trail": [
        [9.88,100,200],
        [9.888,142,203],
        [9.896,188,206],
        [9.904,238,209],
        [9.912,292,212],
        [9.92,350,215],
        [9.928,412,218],
        [9.936,478,221],
        [9.944,548,224],
        [9.952,622,227],
        [9.96,700,230],
        [9.968,782,233],
        [9.976,868,236],
        [9.984,958,239],
        [9.992,1052,242],
        [10,1150,245]
      ],
      "now": 10,
      "cap": 3600,
      "out": [3556.868107395906,152.4372046026817]
    },
    {
      "name": "stale-release",
      "trail": [
        [9.88,100,200],
        [9.888,142,203],
        [9.896,188,206],
        [9.904,238,209],
        [9.912,292,212],
        [9.92,350,215],
        [9.928,412,218],
        [9.936,478,221],
        [9.944,548,224],
        [9.952,622,227],
        [9.96,700,230],
        [9.968,782,233],
        [9.976,868,236],
        [9.984,958,239],
        [9.992,1052,242],
        [10,1150,245]
      ],
      "now": 10.16,
      "cap": 6000,
      "out": [0,0]
    },
    {
      "name": "stale-boundary",
      "trail": [
        [9.88,100,200],
        [9.888,142,203],
        [9.896,188,206],
        [9.904,238,209],
        [9.912,292,212],
        [9.92,350,215],
        [9.928,412,218],
        [9.936,478,221],
        [9.944,548,224],
        [9.952,622,227],
        [9.96,700,230],
        [9.968,782,233],
        [9.976,868,236],
        [9.984,958,239],
        [9.992,1052,242],
        [10,1150,245]
      ],
      "now": 10.15,
      "cap": 6000,
      "out": [0,0]
    },
    {
      "name": "jiggle-only",
      "trail": [
        [9.9,100,300],
        [9.92,108,300],
        [9.94,94,300],
        [9.96,110,300],
        [9.98,92,300],
        [10,104,300],
        [10.02,100,300]
      ],
      "now": 10.02,
      "cap": 6000,
      "out": [0,433.5390820286915]
    },
    {
      "name": "slow-drag",
      "trail": [
        [9.88,100,200],
        [9.9,101.2,200.4],
        [9.92,102.4,200.8],
        [9.940000000000001,103.6,201.2],
        [9.96,104.8,201.6],
        [9.98,106,202],
        [10,107.2,202.4]
      ],
      "now": 10,
      "cap": 6000,
      "out": [59.68488042322241,19.894960141074176]
    },
    {
      "name": "over-cap",
      "trail": [
        [9.88,100,500],
        [9.892000000000001,160,500],
        [9.904,340,500],
        [9.916,640,500],
        [9.928,1060,500],
        [9.940000000000001,1600,500],
        [9.952,2260,500],
        [9.964,3040,500],
        [9.976,3940,500],
        [9.988000000000001,4960,500],
        [10,6100,500]
      ],
      "now": 10,
      "cap": 6000,
      "out": [5999.999975912526,0]
    },
    {
      "name": "dense-sampling",
      "trail": [
        [9.88,100,400],
        [9.883000000000001,115,399.5],
        [9.886000000000001,130,399],
        [9.889000000000001,145,398.5],
        [9.892000000000001,160,398],
        [9.895000000000001,175,397.5],
        [9.898000000000001,190,397],
        [9.901000000000002,205,396.5],
        [9.904,220,396],
        [9.907,235,395.5],
        [9.91,250,395],
        [9.913,265,394.5],
        [9.916,280,394],
        [9.919,295,393.5],
        [9.922,310,393],
        [9.925,325,392.5],
        [9.928,340,392],
        [9.931000000000001,355,391.5],
        [9.934000000000001,370,391],
        [9.937000000000001,385,390.5],
        [9.940000000000001,400,390],
        [9.943000000000001,415,389.5],
        [9.946000000000002,430,389],
        [9.949000000000002,445,388.5],
        [9.952,460,388],
        [9.955,475,387.5],
        [9.958,490,387],
        [9.961,505,386.5],
        [9.964,520,386],
        [9.967,535,385.5],
        [9.97,550,385],
        [9.973,565,384.5],
        [9.976,580,384],
        [9.979000000000001,595,383.5],
        [9.982000000000001,610,383],
        [9.985000000000001,625,382.5],
        [9.988000000000001,640,382],
        [9.991000000000001,655,381.5],
        [9.994000000000002,670,381],
        [9.997000000000002,685,380.5],
        [10,700,380]
      ],
      "now": 10,
      "cap": 6000,
      "out": [3391.7335784939933,-113.05778594979977]
    },
    {
      "name": "window-filter",
      "trail": [[9.5,0,100],[9.6,500,100],[9.7,900,100],[9.88,240,100],[9.9,200,100],[9.95,230,100],[10,250,100]],
      "now": 10,
      "cap": 6000,
      "out": [956.2575399929863,0]
    },
    {
      "name": "left-flick",
      "trail": [
        [9.88,900,300],
        [9.89,849,300],
        [9.9,796,300],
        [9.91,741,300],
        [9.92,684,300],
        [9.930000000000001,625,300],
        [9.940000000000001,564,300],
        [9.950000000000001,501,300],
        [9.96,436,300],
        [9.97,369,300],
        [9.98,300,300],
        [9.99,229,300],
        [10,156,300]
      ],
      "now": 10,
      "cap": 6000,
      "out": [-5008.206670670506,0]
    },
    {"name":"short-span","trail":[[9.99,100,100],[10,300,120]],"now":10,"cap":6000,"out":[0,0]},
    {
      "name": "one-in-window",
      "trail": [[9,0,0],[9.5,50,50],[9.99,100,100]],
      "now": 10,
      "cap": 6000,
      "out": [0,0]
    },
    {
      "name": "decelerating",
      "trail": [
        [9.88,100,250],
        [9.895000000000001,292,250],
        [9.91,468,250],
        [9.925,628,250],
        [9.940000000000001,772,250],
        [9.955,900,250],
        [9.97,1012,250],
        [9.985000000000001,1108,250],
        [10,1188,250]
      ],
      "now": 10,
      "cap": 6000,
      "out": [5030.003439138044,0]
    },
    {
      "name": "zero-cap",
      "trail": [
        [9.88,100,200],
        [9.888,142,203],
        [9.896,188,206],
        [9.904,238,209],
        [9.912,292,212],
        [9.92,350,215],
        [9.928,412,218],
        [9.936,478,221],
        [9.944,548,224],
        [9.952,622,227],
        [9.96,700,230],
        [9.968,782,233],
        [9.976,868,236],
        [9.984,958,239],
        [9.992,1052,242],
        [10,1150,245]
      ],
      "now": 10,
      "cap": 0,
      "out": [0,0]
    }
  ],
  "throwStep": [
    {"args":[50,300,-2000,0,0.05,0,0,800,600,1400],"out":[0,303.5,1560,70,true]},
    {"args":[750,300,1500,-100,0.1,0,0,800,600,1400],"out":[800,304,-1170,40,true]},
    {"args":[400,10,0,-800,0.02,0,0,800,600,1400],"out":[400,0,0,602.16,true]},
    {"args":[400,590,200,500,0.05,0,0,800,600,1400],"out":[410,600,175,-444.6,true]},
    {"args":[400,600,30,0,0.016,0,0,800,600,1400],"out":[400.48,600,28.799999999999997,0,true]},
    {"args":[20,595,-900,300,0.05,0,0,800,600,1400],"out":[0,600,614.25,-288.6,true]},
    {"args":[400,300,100,50,0,0,0,800,600,1400],"out":[400,300,100,50,false]},
    {"args":[400,600,100,0,0,0,0,800,600,1400],"out":[400,600,100,0,true]},
    {"args":[400,300,-50,800,0.03,0,0,800,600,2000],"out":[398.5,325.8,-50,860,false]}
  ],
  "throwStepSeq": [
    {
      "name": "left-wall-land-settle",
      "init": [60,200,-1500,-300],
      "bounds": [0,0,800,600],
      "dt": 0.016,
      "gravity": 1400,
      "steps": [
        [36,195.5584,-1500,-277.6,false],
        [12,191.4752,-1500,-255.20000000000002,false],
        [0,187.7504,1170,-232.8,true],
        [18.72,184.38400000000001,1170,-210.4,false],
        [37.44,181.376,1170,-188,false],
        [56.16,178.7264,1170,-165.6,false],
        [74.88,176.4352,1170,-143.2,false],
        [93.6,174.50240000000002,1170,-120.79999999999998,false],
        [112.32,172.92800000000003,1170,-98.39999999999998,false],
        [131.04,171.71200000000002,1170,-75.99999999999997,false],
        [149.76,170.85440000000003,1170,-53.599999999999966,false],
        [168.48,170.35520000000002,1170,-31.199999999999964,false],
        [187.2,170.2144,1170,-8.799999999999962,false],
        [205.92,170.43200000000002,1170,13.60000000000004,false],
        [224.64,171.008,1170,36.00000000000004,false],
        [243.35999999999999,171.94240000000002,1170,58.40000000000005,false],
        [262.08,173.23520000000002,1170,80.80000000000005,false],
        [280.79999999999995,174.8864,1170,103.20000000000006,false],
        [299.52,176.89600000000002,1170,125.60000000000007,false],
        [318.24,179.264,1170,148.00000000000006,false],
        [336.96000000000004,181.99040000000002,1170,170.40000000000006,false],
        [355.68000000000006,185.07520000000002,1170,192.80000000000007,false],
        [374.4000000000001,188.5184,1170,215.20000000000007,false],
        [393.1200000000001,192.32000000000002,1170,237.60000000000008,false],
        [411.84000000000015,196.48000000000002,1170,260.00000000000006,false],
        [430.5600000000002,200.99840000000003,1170,282.40000000000003,false],
        [449.2800000000002,205.87520000000004,1170,304.8,false],
        [468.0000000000002,211.11040000000003,1170,327.2,false],
        [486.72000000000025,216.70400000000004,1170,349.59999999999997,false],
        [505.4400000000003,222.65600000000003,1170,371.99999999999994,false],
        [524.1600000000003,228.96640000000002,1170,394.3999999999999,false],
        [542.8800000000003,235.63520000000003,1170,416.7999999999999,false],
        [561.6000000000004,242.66240000000002,1170,439.1999999999999,false],
        [580.3200000000004,250.04800000000003,1170,461.59999999999985,false],
        [599.0400000000004,257.79200000000003,1170,483.99999999999983,false],
        [617.7600000000004,265.8944,1170,506.3999999999998,false],
        [636.4800000000005,274.3552,1170,528.7999999999998,false],
        [655.2000000000005,283.17440000000005,1170,551.1999999999998,false],
        [673.9200000000005,292.35200000000003,1170,573.5999999999998,false],
        [692.6400000000006,301.88800000000003,1170,595.9999999999998,false]
      ]
    },
    {
      "name": "drop-bounce-decay",
      "init": [400,100,50,0],
      "bounds": [0,0,800,600],
      "dt": 0.02,
      "gravity": 1400,
      "steps": [
        [401,100.56,50,28,false],
        [402,101.68,50,56,false],
        [403,103.36000000000001,50,84,false],
        [404,105.60000000000001,50,112,false],
        [405,108.4,50,140,false],
        [406,111.76,50,168,false],
        [407,115.68,50,196,false],
        [408,120.16000000000001,50,224,false],
        [409,125.20000000000002,50,252,false],
        [410,130.8,50,280,false],
        [411,136.96,50,308,false],
        [412,143.68,50,336,false],
        [413,150.96,50,364,false],
        [414,158.8,50,392,false],
        [415,167.20000000000002,50,420,false],
        [416,176.16000000000003,50,448,false],
        [417,185.68000000000004,50,476,false],
        [418,195.76000000000005,50,504,false],
        [419,206.40000000000003,50,532,false],
        [420,217.60000000000002,50,560,false],
        [421,229.36,50,588,false],
        [422,241.68,50,616,false],
        [423,254.56,50,644,false],
        [424,268,50,672,false],
        [425,282,50,700,false],
        [426,296.56,50,728,false],
        [427,311.68,50,756,false],
        [428,327.36,50,784,false],
        [429,343.6,50,812,false],
        [430,360.40000000000003,50,840,false],
        [431,377.76000000000005,50,868,false],
        [432,395.68000000000006,50,896,false],
        [433,414.1600000000001,50,924,false],
        [434,433.2000000000001,50,952,false],
        [435,452.8000000000001,50,980,false],
        [436,472.96000000000015,50,1008,false],
        [437,493.6800000000002,50,1036,false],
        [438,514.9600000000002,50,1064,false],
        [439,536.8000000000002,50,1092,false],
        [440,559.2000000000002,50,1120,false]
      ]
    },
    {
      "name": "ceiling-right-wall",
      "init": [300,80,900,-900],
      "bounds": [0,0,800,600],
      "dt": 0.016,
      "gravity": 1400,
      "steps": [
        [314.4,65.9584,900,-877.6,false],
        [328.79999999999995,52.2752,900,-855.2,false],
        [343.19999999999993,38.950399999999995,900,-832.8000000000001,false],
        [357.5999999999999,25.983999999999995,900,-810.4000000000001,false],
        [371.9999999999999,13.375999999999992,900,-788.0000000000001,false],
        [386.39999999999986,1.1263999999999896,900,-765.6000000000001,false],
        [400.79999999999984,0,900,579.6960000000001,true],
        [415.1999999999998,9.633536000000001,900,602.0960000000001,false],
        [429.5999999999998,19.625472000000002,900,624.4960000000001,false],
        [443.9999999999998,29.975808000000004,900,646.8960000000001,false],
        [458.39999999999975,40.684544,900,669.296,false],
        [472.7999999999997,51.75168000000001,900,691.696,false],
        [487.1999999999997,63.17721600000001,900,714.096,false],
        [501.5999999999997,74.96115200000001,900,736.496,false],
        [515.9999999999997,87.10348800000001,900,758.896,false],
        [530.3999999999996,99.60422400000002,900,781.2959999999999,false],
        [544.7999999999996,112.46336000000002,900,803.6959999999999,false],
        [559.1999999999996,125.68089600000002,900,826.0959999999999,false],
        [573.5999999999996,139.25683200000003,900,848.4959999999999,false],
        [587.9999999999995,153.19116800000003,900,870.8959999999998,false],
        [602.3999999999995,167.48390400000002,900,893.2959999999998,false],
        [616.7999999999995,182.13504000000003,900,915.6959999999998,false],
        [631.1999999999995,197.14457600000003,900,938.0959999999998,false],
        [645.5999999999995,212.51251200000002,900,960.4959999999998,false],
        [659.9999999999994,228.23884800000002,900,982.8959999999997,false],
        [674.3999999999994,244.323584,900,1005.2959999999997,false],
        [688.7999999999994,260.76672,900,1027.6959999999997,false],
        [703.1999999999994,277.568256,900,1050.0959999999998,false],
        [717.5999999999993,294.72819200000004,900,1072.4959999999999,false],
        [731.9999999999993,312.246528,900,1094.896,false],
        [746.3999999999993,330.123264,900,1117.296,false],
        [760.7999999999993,348.3584,900,1139.6960000000001,false],
        [775.1999999999992,366.95193600000005,900,1162.0960000000002,false],
        [789.5999999999992,385.90387200000004,900,1184.4960000000003,false],
        [800,405.21420800000004,-702,1206.8960000000004,true],
        [788.768,424.88294400000007,-702,1229.2960000000005,false],
        [777.5360000000001,444.91008000000005,-702,1251.6960000000006,false],
        [766.3040000000001,465.29561600000005,-702,1274.0960000000007,false],
        [755.0720000000001,486.03955200000007,-702,1296.4960000000008,false],
        [743.8400000000001,507.1418880000001,-702,1318.8960000000009,false]
      ]
    }
  ],
  "softClampSpeed": [
    {"args":[0,6000],"out":0},
    {"args":[-100,6000],"out":0},
    {"args":[1,6000],"out":0.9999166712959529},
    {"args":[500,6000],"out":479.73351222406023},
    {"args":[6000,6000],"out":3792.723352971346},
    {"args":[12000,6000],"out":5187.988300580324},
    {"args":[60000,6000],"out":5999.727600421425},
    {"args":[1000000000,6000],"out":6000},
    {"args":[500,0],"out":0},
    {"args":[500,-3],"out":0},
    {"args":[4800,4800],"out":3034.1786823770767}
  ],
  "slingshotSpeed": [
    {"args":[10,24,160,4800],"out":0},
    {"args":[24,24,160,4800],"out":820.6602327340782},
    {"args":[92,24,160,4800],"out":4317.251315208411},
    {"args":[160,24,160,4800],"out":4561.022071834253},
    {"args":[300,24,160,4800],"out":4561.022071834253},
    {"args":[92,24,160,3600],"out":3243.551729890225},
    {"args":[92,24,160,9000],"out":8074.827824082422},
    {"args":[50,160,160,4800],"out":0},
    {"args":[92,24,160,0],"out":0},
    {"args":[92,24,160,-100],"out":0},
    {"args":[60,24,160,250],"out":241.0014229957689}
  ],
  "slingshotDeformation": [
    {"args":[100,0,0.5,1.3],"out":[1.15,0.8846153846153846]},
    {"args":[0,100,0.5,1.3],"out":[0.8846153846153846,1.15]},
    {"args":[70.71067811865476,70.71067811865476,1,1.3],"out":[1.0681095394039324,1.0681095394039324]},
    {"args":[50,50,0,1.3],"out":[1,1]},
    {"args":[0,0,0.7,1.3],"out":[1,1]},
    {"args":[100,0,0.5,1.5],"out":[1.25,0.8333333333333333]},
    {"args":[30,40,0.8,1.3],"out":[0.9894651714152384,1.1060789960767405]},
    {"args":[100,0,1.5,1.3],"out":[1.3,0.7692307692307692]},
    {"args":[100,0,0.5,0.5],"out":[1,1]},
    {"args":[-80,60,0.6,1.3],"out":[1.076264589892105,0.9880804892590673]},
    {"args":[1e-7,0,0.9,1.3],"out":[1,1]}
  ],
  "slingshotTrajectory": [
    {
      "args": [300,-400,0.8,12,1400],
      "out": [
        [0,0],
        [21.81818181818182,-25.388429752066116],
        [43.63636363636364,-43.37190082644628],
        [65.45454545454545,-53.9504132231405],
        [87.27272727272728,-57.123966942148755],
        [109.09090909090911,-52.89256198347104],
        [130.9090909090909,-41.25619834710744],
        [152.72727272727275,-22.214876033057834],
        [174.54545454545456,4.231404958677729],
        [196.3636363636364,38.08264462809922],
        [218.18181818181822,79.33884297520677],
        [240.00000000000006,128.0000000000001]
      ]
    },
    {"args":[0,0,0.8,1,1400],"out":[[0,0]]},
    {"args":[100,100,0.5,5,1400],"out":[[0,0],[12.5,23.4375],[25,68.75],[37.5,135.9375],[50,225]]},
    {"args":[100,100,0,5,1400],"out":[]},
    {"args":[100,100,0.8,0,1400],"out":[]},
    {
      "args": [-200,300,1,8,1400],
      "out": [
        [0,0],
        [-28.57142857142857,57.14285714285714],
        [-57.14285714285714,142.85714285714283],
        [-85.71428571428571,257.1428571428571],
        [-114.28571428571428,400],
        [-142.85714285714283,571.4285714285713],
        [-171.42857142857142,771.4285714285713],
        [-200,1000]
      ]
    },
    {"args":[50,-50,0.4,3,900],"out":[[0,0],[10,8.000000000000004],[20,52.000000000000014]]}
  ],
  "isAtRest": [
    {"args":[600,0,0,600,false,0],"out":true},
    {"args":[600,14.9,0,600,false,14.9],"out":true},
    {"args":[600,15,0,600,false,15],"out":false},
    {"args":[598.5,0,0,600,false,0],"out":false},
    {"args":[599,0,0.9,600,false,0],"out":true},
    {"args":[550,0,0,600,true,30],"out":true},
    {"args":[550,0,0,600,true,40],"out":false},
    {"args":[550,0,1.2,600,true,30],"out":false},
    {"args":[600,0,-0.5,600,false,0.5],"out":true},
    {"args":[600,-14,0.5,600,false,14],"out":true}
  ],
  "strength": [
    {"arg":"gentle","norm":"gentle","cap":3600},
    {"arg":"STANDARD","norm":"standard","cap":4800},
    {"arg":" Strong ","norm":"strong","cap":7200},
    {"arg":"crazy","norm":"crazy","cap":9000},
    {"arg":"nope","norm":"standard","cap":4800},
    {"arg":"","norm":"standard","cap":4800},
    {"arg":null,"norm":"standard","cap":4800},
    {"arg":123,"norm":"standard","cap":4800},
    {"arg":"CRAZY","norm":"crazy","cap":9000},
    {"arg":"GENTLE","norm":"gentle","cap":3600},
    {"arg":"constructor","norm":"standard","cap":4800}
  ]
};

const EPS = 1e-9;
// |js − py| <= 1e-9 scaled to the expected magnitude (keeps the bound tight
// for O(1) values while tolerating last-ulp drift of Math.exp/Math.hypot at
// O(1e3–1e4) magnitudes).
function close(actual, expected, msg) {
  assert.ok(
    Number.isFinite(actual)
      && Math.abs(actual - expected) <= EPS * Math.max(1, Math.abs(expected)),
    `${msg}: js=${actual} py=${expected}`,
  );
}

function closeVec2(actual, expected, msg) {
  close(actual[0], expected[0], `${msg}[0]`);
  close(actual[1], expected[1], `${msg}[1]`);
}

function closeThrow(actual, expected, msg) {
  close(actual.px, expected[0], `${msg}.px`);
  close(actual.py, expected[1], `${msg}.py`);
  close(actual.vx, expected[2], `${msg}.vx`);
  close(actual.vy, expected[3], `${msg}.vy`);
  assert.equal(actual.bounced, expected[4], `${msg}.bounced`);
}

test('PetPhysics is exposed as a plain global object', () => {
  assert.equal(typeof P, 'object');
  for (const k of Object.keys(FIXTURE.constants)) {
    assert.ok(k in P, `missing constant ${k}`);
  }
  for (const f of ['normalizeThrowStrength', 'throwSpeedCap',
    'slingshotDeformation', 'softClampSpeed', 'slingshotSpeed',
    'slingshotTrajectory', 'springVelocity', 'estimateReleaseVelocity',
    'throwStep', 'isAtRest']) {
    assert.equal(typeof P[f], 'function', `missing function ${f}`);
  }
});

test('constants match Python exactly', () => {
  for (const [k, v] of Object.entries(FIXTURE.constants)) {
    if (k === 'THROW_STRENGTH_CAPS') {
      assert.deepEqual(reify(P.THROW_STRENGTH_CAPS), v);
    } else {
      assert.equal(P[k], v, `constant ${k}`);
    }
  }
});

test('springVelocity matches Python', () => {
  for (const c of FIXTURE.springVelocity) {
    close(P.springVelocity(...c.args), c.out, `springVelocity(${c.args})`);
  }
});

test('estimateReleaseVelocity matches Python', () => {
  for (const c of FIXTURE.estimateReleaseVelocity) {
    const got = P.estimateReleaseVelocity(c.trail, c.now, c.cap);
    close(got.vx, c.out[0], `${c.name}.vx`);
    close(got.vy, c.out[1], `${c.name}.vy`);
  }
});

test('throwStep single steps match Python', () => {
  for (const c of FIXTURE.throwStep) {
    closeThrow(P.throwStep(...c.args), c.out, `throwStep(${c.args})`);
  }
});

test('throwStep sequences match Python step-for-step', () => {
  for (const s of FIXTURE.throwStepSeq) {
    let [px, py, vx, vy] = s.init;
    const [l, t, r, b] = s.bounds;
    s.steps.forEach((exp, i) => {
      const got = P.throwStep(px, py, vx, vy, s.dt, l, t, r, b, s.gravity);
      closeThrow(got, exp, `${s.name}[${i}]`);
      ({ px, py, vx, vy } = got);
    });
  }
});

test('softClampSpeed curve matches Python', () => {
  for (const c of FIXTURE.softClampSpeed) {
    close(P.softClampSpeed(...c.args), c.out, `softClampSpeed(${c.args})`);
  }
});

test('slingshotSpeed mapping matches Python', () => {
  for (const c of FIXTURE.slingshotSpeed) {
    close(P.slingshotSpeed(...c.args), c.out, `slingshotSpeed(${c.args})`);
  }
});

test('slingshotDeformation matches Python', () => {
  for (const c of FIXTURE.slingshotDeformation) {
    const got = P.slingshotDeformation(...c.args);
    close(got.sx, c.out[0], `slingshotDeformation(${c.args}).sx`);
    close(got.sy, c.out[1], `slingshotDeformation(${c.args}).sy`);
  }
});

test('slingshotTrajectory matches Python', () => {
  for (const c of FIXTURE.slingshotTrajectory) {
    const got = P.slingshotTrajectory(...c.args);
    assert.equal(got.length, c.out.length, `slingshotTrajectory(${c.args}) len`);
    got.forEach((pt, i) => closeVec2(pt, c.out[i],
      `slingshotTrajectory(${c.args})[${i}]`));
  }
});

test('isAtRest edges match Python', () => {
  for (const c of FIXTURE.isAtRest) {
    assert.equal(P.isAtRest(...c.args), c.out, `isAtRest(${c.args})`);
  }
});

test('throw strength normalization and caps match Python', () => {
  for (const c of FIXTURE.strength) {
    assert.equal(P.normalizeThrowStrength(c.arg), c.norm, `norm(${c.arg})`);
    close(P.throwSpeedCap(c.arg), c.cap, `cap(${c.arg})`);
  }
});

// ---- hand-written edge cases (fixture-independent) ----

test('estimateReleaseVelocity: empty and single-point trails return zero', () => {
  assert.deepEqual(reify(P.estimateReleaseVelocity([], 10.0)), { vx: 0, vy: 0 });
  assert.deepEqual(reify(P.estimateReleaseVelocity([[9.95, 100, 100]], 10.0)),
    { vx: 0, vy: 0 });
});

test('springVelocity with dt=0 returns v unchanged', () => {
  assert.equal(P.springVelocity(5, 10, 20, 0), 5);
  assert.equal(P.springVelocity(-3.5, 0, 999, 0), -3.5);
});

test('throwStep with dt=0 leaves a mid-air state untouched', () => {
  const got = P.throwStep(400, 300, 100, 50, 0, 0, 0, 800, 600);
  assert.deepEqual(reify(got), { px: 400, py: 300, vx: 100, vy: 50, bounced: false });
});

test('throwStep with dt=0 on the ground still reports a bounce and kills vy', () => {
  const got = P.throwStep(400, 600, 100, 0, 0, 0, 0, 800, 600);
  assert.deepEqual(reify(got), { px: 400, py: 600, vx: 100, vy: 0, bounced: true });
});

test('slingshotTrajectory with non-positive args returns []', () => {
  assert.deepEqual(reify(P.slingshotTrajectory(100, 100, -1, 5)), []);
  assert.deepEqual(reify(P.slingshotTrajectory(100, 100, 0.8, -2)), []);
});

test('normalizeThrowStrength handles undefined and objects like Python', () => {
  assert.equal(P.normalizeThrowStrength(undefined), 'standard');
  assert.equal(P.normalizeThrowStrength({}), 'standard');
  assert.equal(P.throwSpeedCap(undefined), FIXTURE.constants.THROW_STRENGTH_CAPS.standard);
});
