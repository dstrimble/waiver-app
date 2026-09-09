// Single source of truth for the waiver copy. The public form fetches this via
// GET /api/waivers/text and the generated PDF renders the same paragraphs, so
// the document a guest receives always matches the text they agreed to.
//
// Bump WAIVER_TEXT_VERSION whenever the paragraphs change. The version is
// stored on every submission so old records stay tied to the copy they signed.
export const WAIVER_TEXT_VERSION = "v1";

export const WAIVER_PARAGRAPHS = [
  "Assumption of risk: The use of Gravitas Mixed Martial Arts naturally involves the risk of injury whether you or someone else causes it. As such, you understand and voluntarily accept this risk and agree that Gravitas Mixed Martial Arts will not be liable for injury, including, without limitation, personal, bodily or mental injury, economic loss or any damage to you or unborn child resulting from negligence of Gravitas Mixed Martial Arts or anyone on Gravitas Mixed Martial Arts' behalf or anyone using the facility, whether the negligence is sole, joint, concurrent, active or passive.",
  "By signing this waiver you acknowledge your assumption of risk and warrant, represent, and agree that you are in good physical condition and that you have no disability, impairment, or ailment preventing you from engaging in active or passive exercise or that will be detrimental or inimical to your health, safety, comfort, or physical condition while engaging or participating in exercise. You also agree that you will not use the facilities with any open cuts, abrasions, open sores, infections, maladies with potential of harm to others, or the like, in accordance with public health requirements.",
  "It is further agreed that all exercises including the use of the facility (including parking lot), weights, number of repetitions, and use of any and all machinery, equipment, and apparatus designed for exercising shall be at your sole risk. Notwithstanding any consultation on exercise programs which may be provided by Gravitas Mixed Martial Arts employees, it is hereby understood that the selection of exercise programs, methods and types of equipment shall be your entire responsibility, and Gravitas Mixed Martial Arts shall not be liable to you for any claims, demands, injuries, damages, or actions arising due to injury to guest's person or property out of or in connection with the use by guest of the services and facilities of Gravitas Mixed Martial Arts on the premises where the same is located.",
];

export const WAIVER_ACCEPTANCE_STATEMENT =
  "I have read and agree to the waiver and release above.";
