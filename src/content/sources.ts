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
    url: 'https://www.imec-int.com/en/semiconductor-education-and-workforce-development/microchips/how-are-microchips-made',
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
    title: 'Eight major steps to semiconductor fabrication, part 5: etching',
    publisher: 'Samsung Newsroom',
    url: 'https://news.samsung.com/global/eight-major-steps-to-semiconductor-fabrication-part-5-etching-a-circuit-pattern',
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
    url: 'https://www.entegris.com/shop/en/USD/Products/Wafer-Handling/Wafer-Processing/300-mm-Front-Opening-Unified-Pods-(FOUPs)/c/300mmfrontopeningunifiedpodsfoups',
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
    url: 'https://amkor.com/test-services/',
  },
  mitInverter: {
    title: '6.012 lecture 13: CMOS circuits',
    publisher: 'MIT (6.012 course notes)',
    url: 'https://web.mit.edu/6.012/www/SP07-L13.pdf',
  },
  svmiWafer: {
    title: '300 mm wafer datasheet (SV027)',
    publisher: 'Silicon Valley Microelectronics',
    url: 'https://svmi.com/wp-content/uploads/2020/09/SV027.pdf',
  },
  foupMinienv: {
    title: 'Particle dynamics in a FOUP/load port unit minienvironment',
    publisher: 'Aerosol Science and Technology',
    url: 'https://www.tandfonline.com/doi/full/10.1080/027868290920115',
  },
  kernRca: {
    title: 'The evolution of silicon wafer cleaning technology',
    publisher: 'W. Kern, Journal of the Electrochemical Society (1990)',
    url: 'https://iopscience.iop.org/article/10.1149/1.2086825',
  },
  semianalysisField: {
    title: 'Die size and reticle conundrum',
    publisher: 'SemiAnalysis',
    url: 'https://newsletter.semianalysis.com/p/die-size-and-reticle-conundrum-cost',
  },
  halbleiterMasks: {
    title: 'Photomasks',
    publisher: 'Halbleiter.org',
    url: 'https://www.halbleiter.org/en/photolithography/photomasks/',
  },
  spieCd: {
    title: 'Controlling CD (step-and-scan exposure)',
    publisher: 'SPIE Newsroom',
    url: 'https://spie.org/news/controlling-cd',
  },
  scanPatent: {
    title: 'Electromagnetic alignment and scanning apparatus (US 6,252,370)',
    publisher: 'US patent (USPTO)',
    url: 'https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6252370',
  },
  asmlAlignStory: {
    title: 'Aligning lithography to the nanometer',
    publisher: 'ASML',
    url: 'https://www.asml.com/en/news/stories/2021/fellow-simon-mathijssen-aligning-lithography-nanometer',
  },
  asmlYieldStar: {
    title: 'YieldStar 375F metrology system (overlay)',
    publisher: 'ASML',
    url: 'https://www.asml.com/en/products/metrology-and-inspection-systems/yieldstar-375f',
  },
  shiCar: {
    title: 'Patterning the world: the rise of chemically amplified photoresists',
    publisher: 'Science History Institute',
    url: 'https://www.sciencehistory.org/stories/magazine/patterning-the-world-the-rise-of-chemically-amplified-photoresists/',
  },
  mcMif: {
    title: 'Metal-ion-free (TMAH) developers',
    publisher: 'MicroChemicals',
    url: 'https://www.microchemicals.com/PRODUCTS/Photochemicals/Developer/MIF/',
  },
  mcDryEtch: {
    title: 'Dry etching with photoresist masks (application note)',
    publisher: 'MicroChemicals',
    url: 'https://www.microchemicals.com/dokumente/application_notes/dry_etching_photoresist.pdf',
  },
  utVlsi: {
    title: 'VLSI-1, lecture 2 (self-aligned polysilicon gates)',
    publisher: 'University of Texas at Austin',
    url: 'https://users.ece.utexas.edu/~mcdermot/vlsi1/main/lectures/lecture_2.pdf',
  },
  mosisRules: {
    title: 'MOSIS scalable CMOS design rules, revision 7.2',
    publisher: 'MOSIS (copy hosted by Rice University)',
    url: 'https://www.ece.rice.edu/Courses/422/manual/mosis_scmos7_2.pdf',
  },
  semieMol: {
    title: 'New BEOL/MOL breakthroughs?',
    publisher: 'Semiconductor Engineering',
    url: 'https://semiengineering.com/new-beolmol-breakthroughs/',
  },
  imecDamascene: {
    title: 'Semi-damascene metallization and back-end-of-line processing',
    publisher: 'imec',
    url: 'https://www.imec-int.com/en/articles/semi-damascene-metallization-inflection-point-back-end-line-processing',
  },
  amkorServices: {
    title: 'Packaging services (wire bond and flip chip)',
    publisher: 'Amkor Technology',
    url: 'https://amkor.com/services/',
  },
} satisfies Record<string, Source>;

export type SourceId = keyof typeof SOURCES;
