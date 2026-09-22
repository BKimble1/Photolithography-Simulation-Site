export interface Source {
  title: string;
  publisher: string;
  url: string;
}

export const SOURCES = {
  asmlPrinciples: {
    title: 'Lithography principles',
    publisher: 'ASML',
    url: 'https://www.asml.com/en/technology/lithography-principles',
  },
  asmlLenses: {
    title: 'Lenses and mirrors',
    publisher: 'ASML',
    url: 'https://www.asml.com/en/technology/lithography-principles/lenses-and-mirrors',
  },
  asmlLight: {
    title: 'Light and lasers',
    publisher: 'ASML',
    url: 'https://www.asml.com/en/technology/lithography-principles/light-and-lasers',
  },
  asmlRayleigh: {
    title: 'The Rayleigh criterion',
    publisher: 'ASML',
    url: 'https://www.asml.com/en/technology/lithography-principles/rayleigh-criterion',
  },
  asmlAccuracy: {
    title: 'Measuring accuracy',
    publisher: 'ASML',
    url: 'https://www.asml.com/en/technology/lithography-principles/measuring-accuracy',
  },
  imecHow: {
    title: 'How are microchips made?',
    publisher: 'imec',
    url: 'https://www.imec-int.com/en/what-we-offer/semiconductor-education-and-workforce-development/microchips/how-are-microchips-made',
  },
  imecRoadmap: {
    title: 'A view on the logic technology roadmap (FEOL, MOL, BEOL)',
    publisher: 'imec',
    url: 'https://www.imec-int.com/en/articles/view-logic-technology-roadmap',
  },
  samsungWafer: {
    title: 'Eight essential processes, part 1: what is a wafer?',
    publisher: 'Samsung Semiconductor',
    url: 'https://semiconductor.samsung.com/support/tools-resources/fabrication-process/eight-essential-semiconductor-fabrication-processes-part-1-what-is-a-wafer/',
  },
  samsungOxidation: {
    title: 'Eight essential processes, part 2: oxidation',
    publisher: 'Samsung Semiconductor',
    url: 'https://semiconductor.samsung.com/support/tools-resources/fabrication-process/eight-essential-semiconductor-fabrication-processes-part-2-oxidation-to-protect-the-wafer/',
  },
  samsungLitho: {
    title: 'Eight essential processes, part 4: photolithography',
    publisher: 'Samsung Semiconductor',
    url: 'https://semiconductor.samsung.com/support/tools-resources/fabrication-process/eight-essential-semiconductor-fabrication-processes-part-4-photolithography-laying-the-blueprint/',
  },
  samsungEtch: {
    title: 'Eight essential processes, part 5: etching',
    publisher: 'Samsung Semiconductor',
    url: 'https://semiconductor.samsung.com/support/tools-resources/fabrication-process/eight-essential-semiconductor-fabrication-processes-part-5-etching-a-circuit-pattern/',
  },
  samsungDepo: {
    title: 'Eight essential processes, part 6: deposition and ion implantation',
    publisher: 'Samsung Semiconductor',
    url: 'https://semiconductor.samsung.com/support/tools-resources/fabrication-process/eight-essential-semiconductor-fabrication-processes-part-6-deposition-and-ion-implantation-for-the-electrical-properties/',
  },
  samsungMetal: {
    title: 'Eight essential processes, part 7: metal interconnects',
    publisher: 'Samsung Semiconductor',
    url: 'https://semiconductor.samsung.com/support/tools-resources/fabrication-process/eight-essential-semiconductor-fabrication-processes-part-7-metal-interconnects-electrical-highways/',
  },
  samsungEds: {
    title: 'Eight essential processes, part 8: EDS (electrical die sorting)',
    publisher: 'Samsung Semiconductor',
    url: 'https://semiconductor.samsung.com/support/tools-resources/fabrication-process/eight-essential-semiconductor-fabrication-processes-part-8-eds-electrical-die-sorting-for-the-perfect-chips/',
  },
  samsungPackaging: {
    title: 'Eight essential processes, part 9: packaging',
    publisher: 'Samsung Semiconductor',
    url: 'https://semiconductor.samsung.com/support/tools-resources/fabrication-process/eight-essential-semiconductor-fabrication-processes-part-9-packaging-to-protect-the-chips-from-external-elements/',
  },
  mcSpin: {
    title: 'Spin-coating of photoresists (application note)',
    publisher: 'MicroChemicals',
    url: 'https://www.microchemicals.com/dokumente/application_notes/spin_coating_photoresist.pdf',
  },
  mcAdhesion: {
    title: 'Substrate cleaning and adhesion promotion (application note)',
    publisher: 'MicroChemicals',
    url: 'https://www.microchemicals.com/dokumente/application_notes/substrate_cleaning_adhesion_photoresist.pdf',
  },
  mcSoftbake: {
    title: 'Softbake of photoresist films (application note)',
    publisher: 'MicroChemicals',
    url: 'https://www.microchemicals.com/dokumente/application_notes/softbake_photoresist.pdf',
  },
  mcPeb: {
    title: 'Post-exposure bake (application note)',
    publisher: 'MicroChemicals',
    url: 'https://www.microchemicals.com/dokumente/application_notes/photoresist_post_exposure_bake_peb.pdf',
  },
  mcDevelop: {
    title: 'Development of photoresists (application note)',
    publisher: 'MicroChemicals',
    url: 'https://www.microchemicals.com/dokumente/application_notes/development_photoresist.pdf',
  },
  mcRemoval: {
    title: 'Photoresist removal (application note)',
    publisher: 'MicroChemicals',
    url: 'https://www.microchemicals.com/dokumente/application_notes/photoresist_removal.pdf',
  },
  mcYellow: {
    title: 'Yellow light for lithography rooms',
    publisher: 'MicroChemicals',
    url: 'https://www.microchemicals.com/PRODUCTS/Yellow-light-products/',
  },
  byuColor: {
    title: 'Oxide and nitride colour chart',
    publisher: 'BYU Integrated Microfabrication Lab',
    url: 'https://www.cleanroom.byu.edu/color_chart',
  },
  ualbertaOx: {
    title: 'Silicon thermal oxidation calculator',
    publisher: 'University of Alberta nanoFAB',
    url: 'https://toolbox.nanofab.ualberta.ca/sithox/index.php',
  },
  mitSti: {
    title: 'Planarization and integration of shallow trench isolation',
    publisher: 'MIT (Boning group)',
    url: 'https://boning.mit.edu/wp-content/uploads/2022/11/Planarization-and-Integration-of-Shallow-Trench-Isolation.pdf',
  },
  hmcCmos: {
    title: 'Introduction to CMOS VLSI design, lecture 0',
    publisher: 'Harvey Mudd College (E158)',
    url: 'https://pages.hmc.edu/harris/class/e158/lect0-intro.pdf',
  },
  irdsYield: {
    title: 'IRDS 2022: Yield enhancement',
    publisher: 'IEEE IRDS',
    url: 'https://irds.ieee.org/images/files/pdf/2022/2022IRDS_YE.pdf',
  },
  nanoGov: {
    title: 'Just how small is "nano"?',
    publisher: 'nano.gov',
    url: 'https://www.nano.gov/about-nanotechnology/just-how-small-is-nano/',
  },
  entegrisFoup: {
    title: '300 mm front-opening unified pods',
    publisher: 'Entegris',
    url: 'https://www.entegris.com/shop/en/USD/Products/Wafer-Handling/Wafer-Processing/300-mm-Front-Opening-Unified-Pods-',
  },
  sumcoProcess: {
    title: 'Silicon wafer manufacturing process',
    publisher: 'SUMCO',
    url: 'https://www.sumcosi.com/english/products/process/',
  },
  semieOverlay: {
    title: 'How overlay keeps pace with EUV patterning',
    publisher: 'Semiconductor Engineering',
    url: 'https://semiengineering.com/how-overlay-keeps-pace-with-euv-patterning/',
  },
  discoDbg: {
    title: 'Dicing before grinding (DBG) process',
    publisher: 'DISCO',
    url: 'https://www.disco.co.jp/eg/solution/library/dbg/dbg_process.html',
  },
  amkorTest: {
    title: 'Test services',
    publisher: 'Amkor Technology',
    url: 'https://amkor.com/services/',
  },
  mitInverter: {
    title: '6.012 lecture: CMOS inverter',
    publisher: 'MIT OpenCourseWare',
    url: 'https://web.mit.edu/6.012/www/SP07-L13.pdf',
  },
} satisfies Record<string, Source>;

export type SourceId = keyof typeof SOURCES;
