export class AppleLookAroundPano {
  coverage_type: number;
  date: number;
  panoId: string;
  heading: number;
  lat: number;
  lng: number;

  constructor(
    coverage_type: number,
    date: string,
    panoId: string,
    heading: number,
    lat: number,
    lng: number
  ) {
    this.coverage_type=coverage_type;
    this.date = Number(date);
    this.panoId = panoId;
    this.heading = heading;
    this.lat = lat;
    this.lng = lng;
  }
}
